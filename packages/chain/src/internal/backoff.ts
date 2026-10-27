/**
 * The one backoff of the reader: every request on a rate-limited or flaky endpoint goes through
 * `withBackoff`, whether `eth_getLogs` (./logs.ts, which splits rejected ranges around it), the
 * multicalls and block reads of the main client (./multicall.ts, reader.ts) or the creation-block
 * search (seed/createdAt.ts), with the reader's policy (`ReaderContext.logRetry`: 8 retries, 1 s
 * doubling to 30 s). Failures are classified like log failures (./logErrors.ts): rate limits (HTTP
 * 429, rate-limit codes and messages) and transient failures (5xx, timeouts, no response) are
 * retried after min(baseDelayMs · 2^n, maxDelayMs), or the provider's Retry-After, at most
 * `retries` times, then fail with `RetryExhaustedError`; anything else fails at once.
 */
import type { LogRetryPolicy, ReaderContext } from './context.js'
import { classifyLogsError, RetryExhaustedError } from './logErrors.js'

export type BackoffPolicy = Pick<LogRetryPolicy, 'retries' | 'baseDelayMs' | 'maxDelayMs' | 'sleep'>

/** One backoff before retrying `what`. */
export interface BackoffEvent {
  reason: 'rate-limit' | 'transient'
  /** 1 for the first retry. */
  attempt: number
  retries: number
  delayMs: number
  /** The request, e.g. `eth_getCode 0x… @ 12345678`. */
  what: string
  providerMessage: string
}

export async function withBackoff<T>(
  policy: BackoffPolicy,
  what: string,
  request: () => Promise<T>,
  onRetry?: (event: BackoffEvent) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request()
    } catch (err) {
      const info = classifyLogsError(err)
      if (info.kind !== 'rate-limit' && info.kind !== 'transient') throw err
      if (attempt >= policy.retries)
        throw new RetryExhaustedError(what, info.kind, policy.retries, info.providerMessage, {
          cause: err,
        })
      const delayMs =
        info.retryAfterMs ?? Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs)
      onRetry?.({
        reason: info.kind,
        attempt: attempt + 1,
        retries: policy.retries,
        delayMs,
        what,
        providerMessage: info.providerMessage,
      })
      await policy.sleep(delayMs)
    }
  }
}

/**
 * A main-endpoint request (`eth_call` / multicall, blocks, `eth_getCode`) under the reader's
 * policy; backoffs go to `onRetry`, else to the reader's `onCallRetry`.
 */
export function callWithBackoff<T>(
  ctx: ReaderContext,
  what: string,
  request: () => Promise<T>,
  onRetry?: (event: BackoffEvent) => void,
): Promise<T> {
  return withBackoff(ctx.logRetry, what, request, onRetry ?? ctx.onCallRetry)
}
