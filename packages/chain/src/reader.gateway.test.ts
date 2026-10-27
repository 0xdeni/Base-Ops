/**
 * Gateway answers and spent retry budgets on the `eth_getLogs` path, over viem's real `http()`
 * transport and a fake `fetch` (no network). A 5xx / 524 from a proxy in front of the node is
 * weather: it is retried on the same range and never read as a rejected range, so a 10-block chunk
 * on Alchemy's free tier survives a gateway blip. A request whose retries run out fails with
 * `RetryExhaustedError` on that one range, without splitting into halves that each spend the whole
 * budget again and end in a misleading LogRangeLimitError.
 */
import { custom, HttpRequestError, http, RpcRequestError, TimeoutError, type Transport } from 'viem'
import { describe, expect, it } from 'vitest'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { addLogs, makeLog } from './fixtures/builders.js'
import { alchemyFreeTierGetLogs, createFakeRpcFetch } from './fixtures/fakeRpc.js'
import { withBackoff } from './internal/backoff.js'
import {
  classifyLogsError,
  LogRangeLimitError,
  RetryExhaustedError,
  redactUrls,
} from './internal/logErrors.js'
import { createChainReader } from './reader.js'
import { addr, newFixture, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

const URL = 'https://base-mainnet.example/v2'

/** Uniswap v3 PoolCreated at blocks 15 and 95. */
function world(): Fixture {
  const fixture = newFixture(200_000n, 1_800_000_000)
  addLogs(
    fixture,
    [15n, 95n].map((blockNumber, i) =>
      makeLog({
        address: A.uniswapV3.factory,
        abi: uniswapV3FactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKEN_A.address,
          token1: TOKEN_D.address,
          fee: 500,
          tickSpacing: 10,
          pool: addr(0x5000 + i),
        },
        blockNumber,
        logIndex: 0,
      }),
    ),
  )
  return fixture
}

const text = (status: number, body: string, type = 'text/plain') =>
  new Response(body, { status, headers: { 'Content-Type': type } })

/** What gateways in front of RPC nodes answer when the upstream is slow (measured shapes). */
const GATEWAY_ANSWERS: Array<[string, () => Response]> = [
  ['envoy 504', () => text(504, 'upstream request timeout')],
  [
    'envoy 503',
    () =>
      text(
        503,
        'upstream connect error or disconnect/reset before headers. reset reason: connection timeout',
      ),
  ],
  [
    'Cloudflare 524',
    () =>
      text(
        524,
        '<!DOCTYPE html><html><head><title>524: A timeout occurred</title></head></html>',
        'text/html',
      ),
  ],
  ['Cloudflare 522', () => text(522, '<html><title>522: Connection timed out</title></html>')],
  ['nginx 504', () => text(504, '<html><title>504 Gateway Time-out</title></html>', 'text/html')],
]

describe('gateway timeouts are transient, never a rejected range', () => {
  it.each(GATEWAY_ANSWERS)(
    '%s on a 10-block chunk: one backoff, same range, served',
    async (_, answer) => {
      const free = alchemyFreeTierGetLogs()
      const rpc = createFakeRpcFetch(world(), {
        getLogs: (request) => (request.n === 0 ? answer() : free(request)),
      })
      const sleeps: number[] = []
      const reader = createChainReader({
        transport: http(URL, { fetchFn: rpc.fetch, retryCount: 0 }),
        logRetry: { sleep: async (ms) => void sleeps.push(ms) },
        logChunkSize: 10,
      })
      expect(await reader.discoverPools('uniswap-v3', 1n, 100n)).toHaveLength(2)
      expect(sleeps).toEqual([1_000])
      const logs = rpc.calls.filter((c) => c.method === 'eth_getLogs')
      expect(logs.slice(0, 2).map((c) => [c.fromBlock, c.toBlock])).toEqual([
        [1n, 10n],
        [1n, 10n],
      ])
      expect(logs).toHaveLength(11) // ten chunks plus the retried one
    },
  )

  it('classifies by the HTTP level: a gateway 5xx is transient, a node message is still a range', () => {
    const gateway = (status: number, details: string) =>
      new HttpRequestError({ url: URL, status, details })
    expect(classifyLogsError(gateway(504, '"upstream request timeout"')).kind).toBe('transient')
    expect(classifyLogsError(gateway(524, '524: A timeout occurred')).kind).toBe('transient')
    expect(classifyLogsError(gateway(408, 'Request Timeout')).kind).toBe('transient')
    expect(
      classifyLogsError(new Error('wrapped', { cause: gateway(503, 'connection timeout') })).kind,
    ).toBe('transient')
    // The node's own JSON-RPC answer (viem: RpcRequestError, whatever the HTTP status).
    const node = new RpcRequestError({
      body: {},
      url: URL,
      error: { code: -32000, message: 'query timeout exceeded' },
    })
    expect(classifyLogsError(node).kind).toBe('range')
    // A stated maximum wins even on a gateway status.
    expect(classifyLogsError(gateway(500, 'max block range 1000')).statedMax).toBe(1_000n)
    expect(classifyLogsError(gateway(501, 'Not Implemented')).kind).toBe('other')
  })
})

/** A transport whose every eth_getLogs times out client-side; `seen` counts them. */
function timingOut(seen: Array<[bigint, bigint]>): Transport {
  const inner = createFixtureTransport(world())
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_getLogs') {
        const [filter] = params as [{ fromBlock: `0x${string}`; toBlock: `0x${string}` }]
        seen.push([BigInt(filter.fromBlock), BigInt(filter.toBlock)])
        throw new TimeoutError({ body: {}, url: URL })
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'timeout', name: 'Timeout', retryCount: 0 })(config)
  }
}

describe('a spent retry budget is final', () => {
  it('fails on the one range after retries + 1 requests, without halving', async () => {
    const seen: Array<[bigint, bigint]> = []
    const reader = createChainReader({
      transport: timingOut(seen),
      logChunkSize: 2_000,
      logRetry: { retries: 2, sleep: async () => {} },
    })
    const error = await reader.discoverPools('uniswap-v3', 1n, 2_000n).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RetryExhaustedError)
    expect(error).not.toBeInstanceOf(LogRangeLimitError)
    expect((error as Error).message).toBe(
      'eth_getLogs blocks 1-2000: still failing after 2 retries with backoff (provider: "The request timed out.")',
    )
    expect((error as Error).cause).toBeInstanceOf(TimeoutError)
    expect(seen).toEqual([
      [1n, 2_000n],
      [1n, 2_000n],
      [1n, 2_000n],
    ])
  })

  it('is never retried again by an outer backoff', async () => {
    const exhausted = new RetryExhaustedError('eth_getLogs blocks 1-10', 'transient', 8, 'x', {
      cause: new TimeoutError({ body: {}, url: URL }),
    })
    expect(classifyLogsError(exhausted).kind).toBe('other')
    expect(classifyLogsError(new Error('step failed', { cause: exhausted })).kind).toBe('other')
    let calls = 0
    const policy = { retries: 3, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => {} }
    await expect(
      withBackoff(policy, 'outer', async () => {
        calls++
        throw exhausted
      }),
    ).rejects.toBe(exhausted)
    expect(calls).toBe(1)
  })
})

describe('redactUrls', () => {
  it('keeps only the origin of every URL, dropping keys in path, query and user info', () => {
    expect(
      redactUrls(
        'Status: 429 URL: https://base-mainnet.g.alchemy.com/v2/SECRETKEY Request body: {"a":1}',
      ),
    ).toBe('Status: 429 URL: https://base-mainnet.g.alchemy.com Request body: {"a":1}')
    expect(redactUrls('"https://lb.drpc.org/ogrpc?network=base&dkey=SECRET"')).toBe(
      '"https://lb.drpc.org"',
    )
    expect(redactUrls('wss://user:SECRET@node.example:8546/ws and http://x.example')).toBe(
      'wss://node.example:8546 and http://x.example',
    )
  })
})
