/**
 * A fake JSON-RPC HTTP endpoint for tests: a `fetch` function for viem's real `http()` transport
 * (`http(url, { fetchFn })`) or for a stubbed global `fetch`, so the whole HTTP error path (status
 * codes, JSON-RPC error bodies, viem's error wrapping) runs without a network. Requests are
 * answered from a Fixture exactly like createFixtureTransport answers them; `getLogs` may answer an
 * `eth_getLogs` itself first, with a provider's HTTP error. Every request is recorded with its URL,
 * so tests can check which endpoint served what.
 *
 * The provider answers below replay what the real endpoints sent when measured:
 * Alchemy's free tier answers a wide `eth_getLogs` with HTTP 400 and JSON-RPC error -32600, Base's
 * public endpoint answers a rate-limited one with HTTP 429 and JSON-RPC error -32011, Tenderly's
 * public gateway answers a span over 1,001 blocks or over 20,000 results with HTTP 200 and -32602
 * "invalid params", and Pocket answers too many addresses × blocks with HTTP 400 and -32602
 * "Invalid params"; those two put the reason only in the error's `data` (measured 2026-10-29).
 */
import { hexToBigInt } from 'viem'
import {
  createFixtureRequestHandler,
  type Fixture,
  type FixtureTransportOptions,
} from '../transport/fixture.js'

export interface FakeRpcCall {
  url: string
  method: string
  /** `eth_getLogs` only. */
  fromBlock?: bigint
  toBlock?: bigint
}

export interface FakeLogsRequest {
  url: string
  id: unknown
  fromBlock: bigint
  toBlock: bigint
  /** 0-based count of `eth_getLogs` requests seen before this one. */
  n: number
}

/** Any request but `eth_getLogs`, for `FakeRpcOptions.respond`. */
export interface FakeRequest {
  url: string
  id: unknown
  method: string
  /** 0-based count of requests of this method seen before this one. */
  n: number
}

export interface FakeRpcOptions extends FixtureTransportOptions {
  /** May answer an `eth_getLogs` itself (a provider error); undefined lets the fixture answer. */
  getLogs?: (request: FakeLogsRequest) => Response | undefined
  /** May answer any other request itself (a provider error); undefined lets the fixture answer. */
  respond?: (request: FakeRequest) => Response | undefined
}

export interface FakeRpc {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  calls: FakeRpcCall[]
}

interface RpcRequestBody {
  id?: unknown
  method: string
  params?: unknown
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const hex = (n: bigint): string => `0x${n.toString(16)}`

/** Alchemy's maximum `eth_getLogs` span on the free tier, in blocks. */
export const ALCHEMY_FREE_TIER_LOG_RANGE = 10n

/** Alchemy's free-tier message for a too-wide `eth_getLogs` starting at `fromBlock`, verbatim. */
export function alchemyFreeTierMessage(
  fromBlock: bigint,
  maxRange: bigint = ALCHEMY_FREE_TIER_LOG_RANGE,
): string {
  return (
    `Under the Free tier plan, you can make eth_getLogs requests with up to a ${maxRange} block ` +
    `range. Based on your parameters, this block range should work: [${hex(fromBlock)}, ` +
    `${hex(fromBlock + maxRange - 1n)}]. Upgrade to PAYG for expanded block range.`
  )
}

/** `getLogs` rule: Alchemy's free-tier HTTP 400 for every request wider than `maxRange` blocks. */
export function alchemyFreeTierGetLogs(
  maxRange: bigint = ALCHEMY_FREE_TIER_LOG_RANGE,
): (request: FakeLogsRequest) => Response | undefined {
  return ({ id, fromBlock, toBlock }) =>
    toBlock - fromBlock + 1n > maxRange
      ? json(
          {
            jsonrpc: '2.0',
            id,
            error: { code: -32600, message: alchemyFreeTierMessage(fromBlock, maxRange) },
          },
          400,
        )
      : undefined
}

/** Base's public endpoint over its 5 requests/s per IP: HTTP 429, JSON-RPC -32011. */
export function basePublicRateLimitResponse(id: unknown): Response {
  return json(
    { jsonrpc: '2.0', id, error: { code: -32011, message: 'request limit reached' } },
    429,
    {
      'x-ratelimit-limit': '5, 5;w=1',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1',
    },
  )
}

/** Tenderly's public gateway's stated `eth_getLogs` span; it serves toBlock - fromBlock = 1000. */
export const TENDERLY_PUBLIC_LOG_RANGE = 1_000n

/**
 * Tenderly's public gateway (https://gateway.tenderly.co/public/base) for an `eth_getLogs` from
 * `fromBlock` over its span limit: HTTP 200, the reason only in `data`, verbatim.
 */
export function tenderlyRangeTooLargeResponse(id: unknown, fromBlock: bigint): Response {
  const data =
    'Block range too large for public access: maximum 1000 blocks. Try with this block range ' +
    `[${hex(fromBlock)}, ${hex(fromBlock + TENDERLY_PUBLIC_LOG_RANGE)}], ` +
    'or use an access key for larger ranges.'
  return json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid params', data } })
}

/**
 * Tenderly's public gateway for an `eth_getLogs` over 20,000 results (its documentation says
 * 3,000): HTTP 200, the reason only in `data`, verbatim; it suggests the first half of the range.
 */
export function tenderlyTooManyResultsResponse(
  id: unknown,
  fromBlock: bigint,
  toBlock: bigint,
): Response {
  const half = fromBlock + (toBlock - fromBlock) / 2n
  const data =
    'Query returned more than 20000 results. Try with this block range ' +
    `[${hex(fromBlock)}, ${hex(half)}].`
  return json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid params', data } })
}

/**
 * `getLogs` rule: Tenderly's public gateway, which rejects spans over 1,001 blocks and, through
 * `tooMany`, the ranges that would return more than 20,000 results.
 */
export function tenderlyPublicGetLogs(
  tooMany: (fromBlock: bigint, toBlock: bigint) => boolean = () => false,
): (request: FakeLogsRequest) => Response | undefined {
  return ({ id, fromBlock, toBlock }) =>
    toBlock - fromBlock > TENDERLY_PUBLIC_LOG_RANGE
      ? tenderlyRangeTooLargeResponse(id, fromBlock)
      : tooMany(fromBlock, toBlock)
        ? tenderlyTooManyResultsResponse(id, fromBlock, toBlock)
        : undefined
}

/** Pocket's message for an `eth_getLogs` over its addresses × blocks cap, verbatim. */
export const POCKET_SCAN_WORK_MESSAGE =
  "getLogs scan work too large: addresses x blocks exceeds this endpoint's cap; narrow the block " +
  'range or split the address list'

/** Pocket (https://base.api.pocket.network) over that cap: HTTP 400, the reason only in `data`. */
export function pocketScanWorkTooLargeResponse(id: unknown): Response {
  return json(
    {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'Invalid params', data: POCKET_SCAN_WORK_MESSAGE },
    },
    400,
  )
}

/** Alchemy's message when an app is over its compute units per second, verbatim. */
export const ALCHEMY_RATE_LIMIT_MESSAGE =
  'Your app has exceeded its compute units per second capacity. If you have retries enabled, ' +
  'you can safely ignore this message. If not, check out ' +
  'https://docs.alchemy.com/reference/throughput'

/** Alchemy (free tier) over its compute-unit rate: HTTP 429, JSON-RPC error 429. */
export function alchemyRateLimitResponse(id: unknown): Response {
  return json(
    { jsonrpc: '2.0', id, error: { code: 429, message: ALCHEMY_RATE_LIMIT_MESSAGE } },
    429,
  )
}

/** The JSON-RPC error a fixture failure becomes: its own code and message, else -32603. */
function rpcErrorOf(error: unknown): { code: number; message: string } {
  const e = error as { code?: unknown; message?: unknown }
  return {
    code: typeof e.code === 'number' ? e.code : -32603,
    message: typeof e.message === 'string' ? e.message : String(error),
  }
}

export function createFakeRpcFetch(fixture: Fixture, opts: FakeRpcOptions = {}): FakeRpc {
  const handler = createFixtureRequestHandler(fixture, opts)
  const calls: FakeRpcCall[] = []
  let logsSeen = 0
  const seen = new Map<string, number>()

  async function answer(url: string, body: RpcRequestBody): Promise<Response | unknown> {
    const { id, method, params } = body
    if (method === 'eth_getLogs') {
      const [filter] = params as [{ fromBlock: `0x${string}`; toBlock: `0x${string}` }]
      const fromBlock = hexToBigInt(filter.fromBlock)
      const toBlock = hexToBigInt(filter.toBlock)
      calls.push({ url, method, fromBlock, toBlock })
      const custom = opts.getLogs?.({ url, id, fromBlock, toBlock, n: logsSeen++ })
      if (custom !== undefined) return custom
    } else {
      calls.push({ url, method })
      const n = seen.get(method) ?? 0
      seen.set(method, n + 1)
      const custom = opts.respond?.({ url, id, method, n })
      if (custom !== undefined) return custom
    }
    try {
      return { jsonrpc: '2.0', id, result: (await handler({ method, params })) ?? null }
    } catch (error) {
      return { jsonrpc: '2.0', id, error: rpcErrorOf(error) }
    }
  }

  async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsed = JSON.parse(String(init?.body)) as RpcRequestBody | RpcRequestBody[]
    if (!Array.isArray(parsed)) {
      const out = await answer(url, parsed)
      return out instanceof Response ? out : json(out)
    }
    const out: unknown[] = []
    for (const body of parsed) {
      const one = await answer(url, body)
      if (one instanceof Response) return one
      out.push(one)
    }
    return json(out)
  }

  return { fetch: fakeFetch, calls }
}
