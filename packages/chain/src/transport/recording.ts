/**
 * Wraps a live transport and records every answer into `sink.calls` under the same keys the
 * fixture transport reads, so a session against a real RPC can be replayed offline. RPC-level
 * errors (those carrying a numeric `code`, e.g. "too many results") are recorded as `$error`
 * entries; transport failures (network, timeouts, viem's `UnknownRpcError` wrapper around a
 * non-RPC throw) are not recorded and propagate.
 */
import type { Hex } from '@depthwatch/core'
import { custom, type Transport, UnknownRpcError } from 'viem'
import type { Fixture } from './fixture.js'
import { fixtureKey } from './key.js'

type TransportConfig = Parameters<Transport>[0]

interface RpcLikeError {
  code: number
  message?: string
  data?: unknown
  details?: string
}

/** The innermost error in the cause chain that carries a JSON-RPC code, if any. */
function rpcError(err: unknown): RpcLikeError | null {
  let found: RpcLikeError | null = null
  let cursor: unknown = err
  for (let depth = 0; depth < 8 && typeof cursor === 'object' && cursor !== null; depth++) {
    const e = cursor as { code?: unknown; cause?: unknown }
    if (typeof e.code === 'number') found = e as RpcLikeError
    cursor = e.cause
  }
  return found instanceof UnknownRpcError ? null : found
}

export function createRecordingTransport(inner: Transport, sink: Fixture): Transport {
  return (config: TransportConfig) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      const key = fixtureKey(method, params)
      try {
        const result = await live.request({ method, params } as never)
        sink.calls[key] = result
        return result
      } catch (err) {
        const rpc = rpcError(err)
        if (rpc) {
          sink.calls[key] = {
            $error: {
              code: rpc.code,
              message: rpc.details ?? rpc.message ?? 'RPC error',
              ...(typeof rpc.data === 'string' ? { data: rpc.data as Hex } : {}),
            },
          }
        }
        throw err
      }
    }
    return custom(
      { request },
      { key: 'recording', name: 'Recording Transport', retryCount: 0 },
    )(config)
  }
}
