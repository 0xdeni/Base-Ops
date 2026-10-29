/**
 * The JSON-RPC error's `data`: read for a range only on a -32602 (Tenderly's public gateway,
 * Pocket), never turning another code's retry into a split; read safely (cycles, bigints, length);
 * and shown as the provider's message only when `details` is JSON-RPC's generic text.
 */
import {
  InternalRpcError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  RpcRequestError,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { withBackoff } from './backoff.js'
import { classifyLogsError } from './logErrors.js'

const URL = 'https://logs.example'

/** A JSON-RPC error as viem's `http()` raises it: the typed error, `data` on its cause. */
const rpcError = (code: number, message: string, data: unknown) => {
  const cause = new RpcRequestError({ body: {}, url: URL, error: { code, message, data } })
  if (code === -32602) return new InvalidParamsRpcError(cause)
  if (code === -32603) return new InternalRpcError(cause)
  if (code === -32005) return new LimitExceededRpcError(cause)
  return cause
}

describe("classifyLogsError and the error's data", () => {
  it('never reads the data of a code other than -32602 as a range', () => {
    for (const data of ['context deadline exceeded', 'request timed out']) {
      expect(classifyLogsError(rpcError(-32603, 'Internal error', data)).kind).toBe('transient')
      expect(classifyLogsError(rpcError(-32602, 'invalid params', data)).kind).toBe('range')
    }
    const limited = rpcError(-32005, 'rate limit exceeded', 'maximum 1000 blocks per request')
    expect(classifyLogsError(limited)).toMatchObject({ kind: 'rate-limit', statedMax: undefined })
  })

  it('keeps retrying a main-endpoint -32603 whose data names a timeout', async () => {
    let calls = 0
    const policy = { retries: 2, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => {} }
    const value = await withBackoff(policy, 'eth_call', async () => {
      calls++
      if (calls === 1) throw rpcError(-32603, 'Internal error', 'context deadline exceeded')
      return 'ok'
    })
    expect({ value, calls }).toEqual({ value: 'ok', calls: 2 })
  })

  it('reads data it cannot serialize as nothing, without throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const data of [cyclic, { n: 1n }]) {
      expect(classifyLogsError(rpcError(-32602, 'invalid params', data))).toMatchObject({
        kind: 'other',
        providerMessage: 'invalid params',
      })
    }
  })

  it('reads only the first 500 characters of data', () => {
    const late = `${'x'.repeat(500)} maximum 1000 blocks`
    expect(classifyLogsError(rpcError(-32602, 'invalid params', late))).toMatchObject({
      kind: 'other',
      statedMax: undefined,
    })
    const early = `maximum 1000 blocks ${'x'.repeat(500)}`
    expect(classifyLogsError(rpcError(-32602, 'invalid params', early)).statedMax).toBe(1_000n)
  })

  it('keeps a specific message over data (ZAN: a trace id in data)', () => {
    const zan =
      'cu limit exceeded; Method "eth_getLogs" is not available for unregistered accounts. ' +
      'Please visit https://zan.top/ and register to unlock more.'
    const info = classifyLogsError(rpcError(-32012, zan, { traceId: '1a186af7ebbba861' }))
    expect(info.providerMessage).toBe(zan.replace('https://zan.top/', 'https://zan.top'))
  })
})
