/**
 * Multicall3 batching on top of viem's `publicClient.multicall`. Calls are split into groups of at
 * most `maxCallsPerMulticall` (DESIGN: ≤ 500) and sent with `batchSize: 0` so viem does not
 * re-chunk by calldata size; every call is `allowFailure` and failures are reported per call.
 *
 * viem reports a failure of the `aggregate3` request itself (transport error, RPC outage, missing
 * fixture entry) as a failure of every call in that group. Those are rethrown here, so callers that
 * treat an individual revert as optional (`optionalResult`) never mistake an outage for "no value".
 * A group whose request is rate limited or transient (HTTP 429, 5xx, timeout) is sent again under
 * the reader's one backoff (./backoff.ts) before that, so a free-tier 429 costs a wait, not a pool.
 */
import { ContractFunctionExecutionError, type ContractFunctionParameters } from 'viem'
import { type BackoffEvent, callWithBackoff } from './backoff.js'
import type { ReaderContext } from './context.js'
import { errorSummary } from './errorText.js'

export type ContractCall = ContractFunctionParameters

export type CallResult =
  | { status: 'success'; result: unknown }
  | { status: 'failure'; error: Error }

/** The error of a group whose whole `aggregate3` request failed, if any. */
function groupLevelError(results: readonly { status: string; error?: Error }[]): Error | undefined {
  for (const r of results) {
    if (r.status !== 'failure') continue
    if (r.error instanceof ContractFunctionExecutionError && r.error.functionName === 'aggregate3')
      return r.error
  }
  return undefined
}

export interface MulticallOptions {
  /** Names the request in backoff events and errors (default `eth_call aggregate3 ×n @ block`). */
  what?: string
  /** Backoffs of this call's groups (default: the reader's `onCallRetry`). */
  onRetry?: (event: BackoffEvent) => void
}

export async function multicallBatched(
  ctx: ReaderContext,
  calls: readonly ContractCall[],
  blockNumber?: bigint,
  opts: MulticallOptions = {},
): Promise<CallResult[]> {
  if (calls.length === 0) return []
  const groups: ContractCall[][] = []
  for (let i = 0; i < calls.length; i += ctx.maxCallsPerMulticall)
    groups.push(calls.slice(i, i + ctx.maxCallsPerMulticall))
  const at = blockNumber === undefined ? '' : ` @ ${blockNumber}`
  const settled = await Promise.all(
    groups.map((contracts, g) => {
      const part = groups.length > 1 ? ` (group ${g + 1}/${groups.length})` : ''
      const what = `${opts.what ?? `eth_call aggregate3 ×${contracts.length}${at}`}${part}`
      return callWithBackoff(
        ctx,
        what,
        async () => {
          const group = await ctx.client.multicall({
            contracts,
            allowFailure: true,
            batchSize: 0,
            multicallAddress: ctx.addresses.multicall3,
            ...(blockNumber === undefined ? {} : { blockNumber }),
          })
          const err = groupLevelError(group)
          if (err) throw err
          return group
        },
        opts.onRetry,
      )
    }),
  )
  return settled
    .flat()
    .map((r) =>
      r.status === 'success'
        ? { status: 'success', result: r.result as unknown }
        : { status: 'failure', error: r.error },
    )
}

/** Unwrap a result or throw with context. */
export function expectResult(r: CallResult | undefined, what: string): unknown {
  if (r === undefined) throw new Error(`multicall: missing result for ${what}`)
  if (r.status === 'failure') throw new Error(`multicall: ${what} failed: ${errorSummary(r.error)}`)
  return r.result
}

export function optionalResult(r: CallResult | undefined): unknown | undefined {
  return r !== undefined && r.status === 'success' ? r.result : undefined
}

export function asBigint(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value)
  throw new TypeError(`${what}: expected bigint, got ${typeof value}`)
}

export function asNumber(value: unknown, what: string): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new TypeError(`${what}: expected number, got ${typeof value}`)
}

export function asTuple(value: unknown, what: string): readonly unknown[] {
  if (Array.isArray(value)) return value
  throw new TypeError(`${what}: expected tuple, got ${typeof value}`)
}
