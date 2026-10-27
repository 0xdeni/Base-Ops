import type { PoolMeta } from '@depthwatch/core'
import { custom, type Transport } from 'viem'
import { describe, expect, it } from 'vitest'
import { BASE_ADDRESSES as A, resolveAddresses, TOKENS } from './addresses.js'
import { setClock } from './fixtures/builders.js'
import { registerSeedWorld, type SeedWorldPool } from './fixtures/seedWorld.js'
import { createChainReader } from './reader.js'
import { type BackoffEvent, probesFor, type SeedProgress } from './seed/index.js'
import { addr } from './test/helpers.js'
import { createFixture, createFixtureTransport, FixtureRpcError } from './transport/fixture.js'

const HEAD = 45_000_000n
const { WETH, USDC, CBBTC } = TOKENS
const addresses = resolveAddresses({ referenceTokens: [WETH, USDC, CBBTC] })
/** Three Uniswap v3 pools, created at blocks 2 000 000, 3 000 000 and 4 000 000. */
const POOLS: SeedWorldPool[] = [
  [WETH, USDC],
  [WETH, CBBTC],
  [USDC, CBBTC],
].map(([a, b], i) => ({
  dex: 'uniswap-v3',
  tokens: [a?.address ?? WETH.address, b?.address ?? USDC.address],
  fee: 500,
  address: addr(0x3001 + i),
  createdAtBlock: BigInt(i + 2) * 1_000_000n,
}))
const PROBES = probesFor(A.uniswapV3.startBlock, HEAD)

/** The seed world; `fail(n)` may replace the n-th `eth_getCode` (0-based) with an error. */
function transport(fail: (n: number) => Error | undefined, codes: { n: number }): Transport {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, { addresses, pools: POOLS })
  const inner = createFixtureTransport(fixture)
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_getCode') {
        const error = fail(codes.n++)
        if (error) throw error
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'scripted', name: 'Scripted', retryCount: 0 })(config)
  }
}

function reader(fail: (n: number) => Error | undefined = () => undefined) {
  const codes = { n: 0 }
  const sleeps: number[] = []
  const r = createChainReader({
    transport: transport(fail, codes),
    addresses,
    logRetry: { sleep: async (ms) => void sleeps.push(ms) },
  })
  return { r, codes, sleeps }
}

const rateLimited = () => new FixtureRpcError({ code: -32011, message: 'request limit reached' })

describe('seedPools: creation-block search', () => {
  it('hands each finished batch to onPools, known pools first', async () => {
    const { r, codes } = reader()
    const batches: Array<{ ids: string[]; progress: SeedProgress }> = []
    const known = `uniswap-v3:${POOLS[2]?.address}`
    const seeded = await r.seedPools({
      dexes: ['uniswap-v3'],
      batchSize: 1,
      knownCreatedAt: (id) => (id === known ? 4_000_000n : undefined),
      onPools: (pools: PoolMeta[], progress) =>
        batches.push({ ids: pools.map((p) => p.id), progress }),
    })
    expect(batches.map((b) => b.ids.length)).toEqual([1, 1, 1])
    expect(batches[0]?.ids).toEqual([known])
    // A binary search over n blocks takes ⌊log2 n⌋ or ⌈log2 n⌉ probes, depending on the target.
    const [known0, first, second] = batches.map((b) => b.progress)
    expect(known0).toEqual({ done: 0, total: 2, requests: 0 })
    expect(first).toMatchObject({ done: 1, total: 2 })
    expect(second).toMatchObject({ done: 2, total: 2 })
    expect(first?.requests).toBeGreaterThanOrEqual(PROBES - 1)
    expect(first?.requests).toBeLessThanOrEqual(PROBES)
    expect((second?.requests ?? 0) - (first?.requests ?? 0)).toBeGreaterThanOrEqual(PROBES - 1)
    expect(second?.requests).toBe(codes.n)
    expect(seeded.pools.map((p) => p.createdAtBlock).sort()).toEqual([
      2_000_000n,
      3_000_000n,
      4_000_000n,
    ])
    expect(seeded.searchRounds).toBe(codes.n) // one target per batch: one probe per round
    expect(codes.n).toBeLessThanOrEqual(2 * PROBES)
  })

  it('backs off on rate limits, honouring the retry policy, and reports each backoff', async () => {
    const { r, sleeps } = reader((n) => (n === 0 || n === 1 || n === 5 ? rateLimited() : undefined))
    const retries: BackoffEvent[] = []
    const seeded = await r.seedPools({
      dexes: ['uniswap-v3'],
      concurrency: 1, // the second eth_getCode is the first one's retry
      onRetry: (e) => retries.push(e),
    })
    expect(seeded.pools.map((p) => p.createdAtBlock).sort()).toEqual([
      2_000_000n,
      3_000_000n,
      4_000_000n,
    ])
    expect(retries.map((e) => [e.reason, e.attempt, e.delayMs])).toEqual([
      ['rate-limit', 1, 1_000],
      ['rate-limit', 2, 2_000],
      ['rate-limit', 1, 1_000],
    ])
    expect(retries[0]?.what).toMatch(/^eth_getCode 0x[0-9a-f]{40} @ \d+$/)
    expect(retries[0]?.providerMessage).toContain('request limit reached')
    expect(sleeps).toEqual([1_000, 2_000, 1_000])
  })

  it('stops starting probes after a failure that is not retryable', async () => {
    const reverted = new FixtureRpcError({ code: -32000, message: 'missing trie node' })
    const { r, codes } = reader((n) => (n === 1 ? reverted : undefined))
    const stored: string[] = []
    await expect(
      r.seedPools({
        dexes: ['uniswap-v3'],
        concurrency: 1,
        onPools: (pools) => stored.push(...pools.map((p) => p.id)),
      }),
    ).rejects.toThrow(/missing trie node/)
    expect(codes.n).toBe(2) // the third target's first probe never started
    expect(stored).toEqual([])
  })

  it('gives up after the policy retries with the provider message', async () => {
    const { r, sleeps } = reader(() => rateLimited())
    await expect(r.seedPools({ dexes: ['uniswap-v3'], concurrency: 1 })).rejects.toThrow(
      /eth_getCode .*: still rate limited after 8 retries with backoff \(provider: ".*request limit reached/,
    )
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
  })
})
