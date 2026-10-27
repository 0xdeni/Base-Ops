/**
 * `onRequest` and `signal` of the reader: every JSON-RPC request is heard once per send (retries
 * included) with the endpoint it went to, and an aborted signal stops the reader, whether the
 * request is not sent yet, waiting in a backoff or in flight. Over viem's real `http()` transport
 * and a fake `fetch` (no network).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { addLogs, makeLog } from './fixtures/builders.js'
import { basePublicRateLimitResponse, createFakeRpcFetch } from './fixtures/fakeRpc.js'
import { createChainReader } from './reader.js'
import { addr, newFixture, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'
import type { RpcRequestEvent } from './transport/observed.js'

const MAIN = 'https://main.example/v2'
const LOGS = 'https://logs.example/'

/** One Uniswap v3 PoolCreated at block 150. */
function world(): Fixture {
  const fixture = newFixture(10_000n, 1_800_000_000)
  addLogs(fixture, [
    makeLog({
      address: A.uniswapV3.factory,
      abi: uniswapV3FactoryAbi,
      eventName: 'PoolCreated',
      args: {
        token0: TOKEN_A.address,
        token1: TOKEN_D.address,
        fee: 500,
        tickSpacing: 10,
        pool: addr(0x5000),
      },
      blockNumber: 150n,
      logIndex: 0,
    }),
  ])
  return fixture
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('onRequest', () => {
  it('hears every request sent, retries included, on the endpoint that served it', async () => {
    const rpc = createFakeRpcFetch(world(), {
      getLogs: ({ id, n }) => (n === 0 ? basePublicRateLimitResponse(id) : undefined),
    })
    vi.stubGlobal('fetch', rpc.fetch)
    const events: RpcRequestEvent[] = []
    const reader = createChainReader({
      rpcUrl: MAIN,
      logsRpcUrl: LOGS,
      logChunkSize: 2_000,
      logRetry: { sleep: async () => {} },
      onRequest: (event) => events.push(event),
    })
    expect(await reader.discoverPools('uniswap-v3', 1n, 2_000n)).toHaveLength(1)
    expect(events).toHaveLength(rpc.calls.length)
    const logs = events.filter((e) => e.endpoint === 'logs')
    expect(logs).toEqual([
      { endpoint: 'logs', method: 'eth_getLogs' },
      { endpoint: 'logs', method: 'eth_getLogs' },
    ])
    const main = events.filter((e) => e.endpoint === 'main')
    expect(main.length).toBe(rpc.calls.filter((c) => c.url === MAIN).length)
    expect(main.every((e) => e.method !== 'eth_getLogs')).toBe(true)
  })

  it('labels eth_getLogs as logs on a shared caller transport', async () => {
    const events: RpcRequestEvent[] = []
    const reader = createChainReader({
      transport: createFixtureTransport(world()),
      onRequest: (event) => events.push(event),
    })
    await reader.discoverPools('uniswap-v3', 1n, 2_000n)
    expect(events.filter((e) => e.method === 'eth_getLogs').map((e) => e.endpoint)).toEqual([
      'logs',
    ])
    expect(events.some((e) => e.endpoint === 'main' && e.method === 'eth_call')).toBe(true)
  })
})

describe('signal', () => {
  it('sends nothing once aborted', async () => {
    const rpc = createFakeRpcFetch(world())
    vi.stubGlobal('fetch', rpc.fetch)
    const controller = new AbortController()
    controller.abort()
    const reader = createChainReader({ rpcUrl: MAIN, signal: controller.signal })
    const error = await reader.getLatestBlock().catch((e: unknown) => e)
    expect((error as Error).name).toBe('AbortError')
    expect(rpc.calls).toHaveLength(0)
  })

  it('ends a backoff wait at once instead of retrying', async () => {
    const rpc = createFakeRpcFetch(world(), {
      getLogs: ({ id }) => basePublicRateLimitResponse(id),
    })
    vi.stubGlobal('fetch', rpc.fetch)
    const controller = new AbortController()
    const reader = createChainReader({
      rpcUrl: MAIN,
      logChunkSize: 2_000,
      signal: controller.signal,
      // A wait that never ends on its own: only the signal can end it.
      logRetry: {
        sleep: () => new Promise<void>(() => {}),
        onRetry: () => controller.abort(),
      },
    })
    const error = await reader.discoverPools('uniswap-v3', 1n, 2_000n).catch((e: unknown) => e)
    expect((error as Error).name).toBe('AbortError')
    expect(rpc.calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(1)
  })

  it('cancels a request in flight', async () => {
    let started = 0
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          started++
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const controller = new AbortController()
    const reader = createChainReader({ rpcUrl: MAIN, signal: controller.signal })
    const pending = reader.getLatestBlock().catch((e: unknown) => e)
    await vi.waitFor(() => expect(started).toBe(1))
    controller.abort()
    const error = await pending
    expect((error as Error).name).toBe('AbortError')
    expect(started).toBe(1)
  })
})
