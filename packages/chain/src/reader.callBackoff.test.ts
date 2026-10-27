/**
 * The main endpoint under the reader's one backoff: a rate-limited multicall or block read waits
 * 1 s, 2 s, … and is sent again (the live run on Alchemy's free tier lost 2-3 of 492 pools per
 * snapshot to viem's three quick retries), and the error that ends a spent budget names the method,
 * never the request body. Over viem's real `http()` transport and a fake `fetch` (no network).
 */
import { getSqrtRatioAtTick } from '@depthwatch/core'
import { http } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALCHEMY_RATE_LIMIT_MESSAGE,
  alchemyRateLimitResponse,
  createFakeRpcFetch,
  type FakeRequest,
} from './fixtures/fakeRpc.js'
import type { BackoffEvent } from './internal/backoff.js'
import { errorSummary } from './internal/errorText.js'
import { RetryExhaustedError } from './internal/logErrors.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import {
  addr,
  type ConcentratedSpec,
  newFixture,
  poolMeta,
  registerConcentratedPool,
  TOKEN_A,
  TOKEN_D,
} from './test/helpers.js'

const URL = 'https://base-mainnet.g.alchemy.com/v2'
const BLOCK = 500n

const pool = poolMeta({
  dex: 'uniswap-v3',
  address: addr(0x310),
  token0: TOKEN_A,
  token1: TOKEN_D,
  feePips: 500,
  tickSpacing: 10,
})
const spec: ConcentratedSpec = {
  sqrtPriceX96: getSqrtRatioAtTick(-5),
  tick: -5,
  liquidity: 300n,
  feePips: 500,
  tickSpacing: 10,
  bitmaps: { [-1]: 1n << 255n, 0: 1n },
  ticks: { [-10]: [300n, 300n], 0: [300n, -300n] },
}

function setup(
  respond: (request: FakeRequest) => Response | undefined,
  opts: CreateChainReaderOptions = {},
) {
  const fixture = newFixture()
  registerConcentratedPool(fixture, pool, spec, [BLOCK])
  const rpc = createFakeRpcFetch(fixture, { respond })
  const sleeps: number[] = []
  const events: BackoffEvent[] = []
  const reader = createChainReader({
    transport: http(URL, { fetchFn: rpc.fetch, retryCount: 0 }),
    logRetry: { sleep: async (ms) => void sleeps.push(ms) },
    onCallRetry: (event) => events.push(event),
    ...opts,
  })
  return { reader, rpc, sleeps, events }
}

const once = (method: string) => (request: FakeRequest) =>
  request.method === method && request.n === 0 ? alchemyRateLimitResponse(request.id) : undefined

describe('main-endpoint backoff', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the pool when a readState multicall is rate limited once', async () => {
    const clean = await setup(() => undefined).reader.readState(pool, {
      bandPct: 5,
      blockNumber: BLOCK,
    })
    const { reader, rpc, sleeps, events } = setup(once('eth_call'))
    expect(await reader.readState(pool, { bandPct: 5, blockNumber: BLOCK })).toEqual(clean)
    expect(sleeps).toEqual([1_000])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      reason: 'rate-limit',
      attempt: 1,
      retries: 8,
      delayMs: 1_000,
    })
    expect(events[0]?.what).toBe(`eth_call aggregate3 ×4 @ ${BLOCK}`)
    expect(events[0]?.providerMessage).toContain('compute units per second')
    expect(rpc.calls.filter((c) => c.method === 'eth_call')).toHaveLength(4) // 3 reads + 1 retry
  })

  it('backs off a rate-limited block read', async () => {
    const { reader, sleeps, events } = setup(once('eth_getBlockByNumber'))
    expect((await reader.getLatestBlock()).number).toBe(10_000n)
    expect(sleeps).toEqual([1_000])
    expect(events[0]?.what).toBe('eth_getBlockByNumber latest')
  })

  it('ends a spent budget with RetryExhaustedError and a short message', async () => {
    const { reader, rpc } = setup(
      (request) =>
        request.method === 'eth_call' ? alchemyRateLimitResponse(request.id) : undefined,
      { logRetry: { retries: 2, sleep: async () => {} } },
    )
    const error = await reader.readState(pool, { bandPct: 5, blockNumber: BLOCK }).catch((e) => e)
    expect(error).toBeInstanceOf(RetryExhaustedError)
    expect(rpc.calls.filter((c) => c.method === 'eth_call')).toHaveLength(3)
    const line = errorSummary(error)
    expect(line).toContain(
      `eth_call aggregate3 ×4 @ ${BLOCK}: still rate limited after 2 retries with backoff`,
    )
    // A JSON-RPC error body on HTTP 429 is viem's RpcRequestError: the code, not the status.
    expect(line).toContain('Code: 429 URL: https://base-mainnet.g.alchemy.com Method: eth_call')
    expect(line).toContain(ALCHEMY_RATE_LIMIT_MESSAGE.slice(0, 40))
    // viem's message carries the request body: the aggregate3 calldata (selector 0x82ad56cb).
    expect((error as Error).cause).toBeDefined()
    expect(String((error as { cause: Error }).cause.message)).toContain('Request body')
    expect(line).not.toContain('Request body')
    expect(line).not.toContain('82ad56cb')
    expect(line.length).toBeLessThan(800)
  })

  it('summarises a plain-text 429 (viem HttpRequestError) by status and method', async () => {
    const { reader } = setup(
      (request) =>
        request.method === 'eth_call'
          ? new Response('Too Many Requests', { status: 429 })
          : undefined,
      { logRetry: { retries: 1, sleep: async () => {} } },
    )
    const error = await reader.readState(pool, { bandPct: 5, blockNumber: BLOCK }).catch((e) => e)
    const line = errorSummary(error)
    expect(line).toContain(
      'HTTP request failed. Status: 429 URL: https://base-mainnet.g.alchemy.com',
    )
    expect(line).toContain('Method: eth_call Details: "Too Many Requests"')
    expect(line).not.toContain('Request body')
    expect(line).not.toContain('82ad56cb')
  })

  it('builds the rpcUrl transport without viem retries: one 429, one retry', async () => {
    const { rpc } = setup(once('eth_call'))
    vi.stubGlobal('fetch', rpc.fetch)
    const sleeps: number[] = []
    const reader = createChainReader({
      rpcUrl: URL,
      logRetry: { sleep: async (ms) => void sleeps.push(ms) },
    })
    await reader.readState(pool, { bandPct: 5, blockNumber: BLOCK })
    expect(rpc.calls.filter((c) => c.method === 'eth_call')).toHaveLength(4)
    expect(sleeps).toEqual([1_000])
  })
})

describe('errorSummary', () => {
  it('summarises batched request bodies by method', async () => {
    const { requestMethods } = await import('./internal/errorText.js')
    expect(requestMethods({ method: 'eth_call', params: ['0xdead'] })).toBe('eth_call')
    expect(
      requestMethods([{ method: 'eth_call' }, { method: 'eth_call' }, { method: 'eth_chainId' }]),
    ).toBe('batch of 3: eth_call ×2, eth_chainId')
    expect(requestMethods(undefined)).toBeUndefined()
  })

  it('keeps plain errors and their causes as before', () => {
    const inner = new Error('inner')
    expect(errorSummary(new Error('outer', { cause: inner }))).toBe('outer: inner')
    expect(errorSummary(new Error('see https://x.example/v2/KEY'))).toBe('see https://x.example')
    expect(errorSummary('plain text')).toBe('plain text')
  })
})
