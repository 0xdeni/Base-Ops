/**
 * Wraps a transport so the reader's owner can see and stop its traffic: `onRequest` hears every
 * JSON-RPC request as it is sent (retries included, since each one is sent again), with the
 * endpoint it went to, and once `signal` aborts every further request fails at once with the
 * signal's reason instead of reaching the network. The wrapper sits outside viem's own request
 * handling, so errors and results pass through unchanged.
 */
import type { Transport } from 'viem'

/** `main`: every read but `eth_getLogs`; `logs`: `eth_getLogs` only (see reader.ts). */
export type RpcEndpoint = 'main' | 'logs'

export interface RpcRequestEvent {
  endpoint: RpcEndpoint
  /** The JSON-RPC method, e.g. `eth_call` (a multicall is one `eth_call`). */
  method: string
}

export interface ObserveOptions {
  /** The endpoint a request counts against; a function of the method for a shared transport. */
  endpoint: RpcEndpoint | ((method: string) => RpcEndpoint)
  onRequest?: (event: RpcRequestEvent) => void
  signal?: AbortSignal
}

/** `inner` with `opts.onRequest` and `opts.signal` applied; `inner` itself when neither is set. */
export function observeTransport(inner: Transport, opts: ObserveOptions): Transport {
  const { onRequest, signal } = opts
  if (onRequest === undefined && signal === undefined) return inner
  const endpointOf =
    typeof opts.endpoint === 'function' ? opts.endpoint : () => opts.endpoint as RpcEndpoint
  const observed = (config: Parameters<Transport>[0]) => {
    const live = inner(config)
    const request = ((args: { method: string }, options?: unknown) => {
      if (signal?.aborted) return Promise.reject(signal.reason)
      onRequest?.({ endpoint: endpointOf(args.method), method: args.method })
      return (live.request as (a: unknown, o?: unknown) => Promise<unknown>)(args, options)
    }) as typeof live.request
    return { ...live, request }
  }
  return observed as Transport
}

/**
 * `sleep` that ends early when `signal` aborts, rejecting with the signal's reason (and clearing
 * the default timer, so a backoff wait never keeps a stopping process alive).
 */
export function abortableSleep(
  signal: AbortSignal,
  sleep?: (ms: number) => Promise<void>,
): (ms: number) => Promise<void> {
  return (ms) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => {
        if (timer !== undefined) clearTimeout(timer)
        reject(signal.reason)
      }
      const done = () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (sleep === undefined) timer = setTimeout(done, ms)
      else
        sleep(ms).then(done, (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        })
    })
}
