/**
 * The time-varying synthetic world (docs/design/web-v2.md §3): epochs resolve to blocks of the
 * anchor's clock, fixtures are deterministic per seed, prices drift and liquidity cycles within
 * their bounds, the scripted market-maker events happen at the stated times (seen through the
 * reader, as the pipeline sees them), position logs and swaps form one history across epochs.
 */
import { type ConcentratedState, DEXES, type PoolMeta, sqrtPriceX96ToPrice } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { createChainReader } from '../reader.js'
import { createFixtureTransport } from '../transport/fixture.js'
import {
  createSyntheticFixture,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_OWNERS,
  SYNTHETIC_POOL_IDS,
  SYNTHETIC_PRICES,
  type SyntheticOptions,
  syntheticEventsAt,
  syntheticWorld,
} from './synthetic.js'
import {
  HOUR_SECONDS,
  liquidityFactor,
  priceFactor,
  resolveTimeline,
  SYNTHETIC_EVENTS,
  SYNTHETIC_HISTORY,
} from './syntheticTime.js'

const NOW = SYNTHETIC_DEFAULTS.latestTimestamp
const HOUR = HOUR_SECONDS
const DAY = 24 * HOUR

function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

function readerAt(opts: SyntheticOptions) {
  return createChainReader({
    transport: createFixtureTransport(createSyntheticFixture(opts)),
    logChunkSize: 100_000,
  })
}

/** The world's DEXes: the Aero adapters reject discovery until the world holds Aero pools. */
const WORLD_DEXES = DEXES.filter((dex) => syntheticWorld().pools.some((p) => p.meta.dex === dex))

async function discoverAll(reader: ReturnType<typeof readerAt>, toBlock: bigint) {
  const pools: PoolMeta[] = []
  for (const dex of WORLD_DEXES) pools.push(...(await reader.discoverPools(dex, 1n, toBlock)))
  return pools
}

function poolById(pools: readonly PoolMeta[], id: string): PoolMeta {
  const pool = pools.find((p) => p.id === id)
  if (pool === undefined) throw new Error(`${id} not discovered`)
  return pool
}

describe('resolveTimeline', () => {
  it('is null without an epoch and maps an epoch to the anchor clock', () => {
    expect(resolveTimeline({})).toBeNull()
    const t = resolveTimeline({ epochTimestamp: NOW - 2 * HOUR })
    expect(t).toMatchObject({
      anchorBlock: SYNTHETIC_DEFAULTS.latestBlock,
      anchorTimestamp: NOW,
      seed: SYNTHETIC_DEFAULTS.seed,
      epochBlock: SYNTHETIC_DEFAULTS.latestBlock - 3_600n,
      epochTimestamp: NOW - 2 * HOUR,
      epochHour: NOW / HOUR - 2,
    })
    // By block, and an odd second resolves to the last block at or before it.
    expect(resolveTimeline({ epochBlock: SYNTHETIC_DEFAULTS.latestBlock - 3_600n })).toEqual(t)
    expect(resolveTimeline({ epochTimestamp: NOW - 3 })?.epochTimestamp).toBe(NOW - 4)
  })

  it('rejects epochs outside the history, a disagreeing block and a too-short chain', () => {
    expect(() => resolveTimeline({ epochTimestamp: NOW + 1 })).toThrow(/after latestTimestamp/)
    expect(() => resolveTimeline({ epochBlock: SYNTHETIC_DEFAULTS.latestBlock + 1n })).toThrow(
      RangeError,
    )
    expect(() =>
      resolveTimeline({ epochTimestamp: NOW - SYNTHETIC_HISTORY.maxAgeSeconds - 2 }),
    ).toThrow(/between/)
    expect(() =>
      resolveTimeline({ epochTimestamp: NOW, epochBlock: SYNTHETIC_DEFAULTS.latestBlock - 1n }),
    ).toThrow(/not the block/)
    expect(() => resolveTimeline({ latestBlock: 100_000n, epochTimestamp: NOW })).toThrow(
      /latestBlock/,
    )
  })
})

describe('createSyntheticFixture with an epoch', () => {
  it('is deterministic per seed, JSON-serialisable, and its head is the epoch', async () => {
    const opts = { epochTimestamp: NOW - 30 * HOUR }
    const fixture = createSyntheticFixture(opts)
    expect(stringify(createSyntheticFixture(opts))).toBe(stringify(fixture))
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture)
    expect(stringify(createSyntheticFixture({ ...opts, seed: 2 }))).not.toBe(stringify(fixture))
    const reader = createChainReader({ transport: createFixtureTransport(fixture) })
    expect(await reader.getLatestBlock()).toEqual({
      number: SYNTHETIC_DEFAULTS.latestBlock - 54_000n,
      timestamp: NOW - 30 * HOUR,
    })
  })

  it('keeps pool identities across epochs and drifts ETH within ±4 % at a liquidity that cycles', async () => {
    const early = readerAt({ epochTimestamp: NOW - 7 * DAY })
    const late = readerAt({ epochTimestamp: NOW })
    const head = SYNTHETIC_DEFAULTS.latestBlock
    const pools = await discoverAll(early, head - 302_400n)
    expect(pools).toHaveLength(6)
    expect(await discoverAll(late, head)).toEqual(pools)
    const v3 = poolById(pools, SYNTHETIC_POOL_IDS.wethUsdcV3)
    const prices: number[] = []
    const liquidity: bigint[] = []
    for (let age = 0; age <= 7 * DAY; age += 12 * HOUR) {
      const reader = readerAt({ epochTimestamp: NOW - age })
      const state = (await reader.readState(v3, { bandPct: 5 })) as ConcentratedState
      prices.push(sqrtPriceX96ToPrice(state.sqrtPriceX96, 18, 6))
      liquidity.push(state.liquidity)
    }
    for (const price of prices)
      expect(Math.abs(price / SYNTHETIC_PRICES.ETH - 1)).toBeLessThan(0.04)
    expect(Math.max(...prices) / Math.min(...prices)).toBeGreaterThan(1.01)
    expect(new Set(liquidity).size).toBeGreaterThan(5)
    for (let pool = 0; pool < 6; pool++)
      for (let hour = NOW / HOUR - 8 * 24; hour <= NOW / HOUR; hour++) {
        const f = liquidityFactor(1, pool, 0, hour)
        expect(f).toBeGreaterThanOrEqual(0.75)
        expect(f).toBeLessThanOrEqual(1.25)
        expect(Math.abs(priceFactor(1, 'ETH', hour) - 1)).toBeLessThanOrEqual(0.04)
      }
  })

  it('runs the scripted market-maker events at the stated times', async () => {
    const events = (hoursAgo: number) => syntheticEventsAt(NOW - hoursAgo * HOUR)
    const { cycleHours, outHours } = SYNTHETIC_EVENTS.aeroMarketMaker
    expect(events(0).aeroMarketMakerOut).toBe(true)
    expect(events(outHours - 1).aeroMarketMakerOut).toBe(true)
    expect(events(outHours).aeroMarketMakerOut).toBe(false)
    expect(events(cycleHours - 1).aeroMarketMakerOut).toBe(false)
    expect(events(cycleHours).aeroMarketMakerOut).toBe(true)
    const dipped = Array.from({ length: 7 * 24 }, (_, h) => events(h).slipstreamMarketMakerDipped)
    expect(dipped.filter(Boolean)).toHaveLength(SYNTHETIC_EVENTS.slipstreamMarketMaker.hours)
    expect(dipped.indexOf(true)).toBe(57)
    expect(syntheticEventsAt(NOW - 62 * HOUR).slipstreamMarketMakerDipped).toBe(true)
    expect(syntheticEventsAt(NOW - 62 * HOUR - 1).slipstreamMarketMakerDipped).toBe(false)
    expect(syntheticEventsAt(NOW - 56 * HOUR).slipstreamMarketMakerDipped).toBe(false)

    // Through the reader: the staked Slipstream position and the USDC/AERO LP holding.
    const head = SYNTHETIC_DEFAULTS.latestBlock
    const pools = await discoverAll(readerAt({ epochTimestamp: NOW }), head)
    const slip = poolById(pools, SYNTHETIC_POOL_IDS.wethUsdcSlipstream)
    const aero = poolById(pools, SYNTHETIC_POOL_IDS.usdcAeroV2)
    const mmLiquidity = async (hoursAgo: number) => {
      const reader = readerAt({ epochTimestamp: NOW - hoursAgo * HOUR })
      const latest = await reader.getLatestBlock()
      const positions = await reader.readPositions(slip, { fromBlock: 1n, toBlock: latest.number })
      const resolved = await reader.resolveStakedOwners(slip, positions, [SYNTHETIC_OWNERS[1]!])
      const mine = resolved.filter((p) => p.owner === SYNTHETIC_OWNERS[1])
      expect(mine).toHaveLength(1)
      return mine[0]?.liquidity
    }
    const full = 2n * 10n ** 18n
    expect(await mmLiquidity(63)).toBe(full)
    expect(await mmLiquidity(60)).toBe((full * 12n) / 100n)
    expect(await mmLiquidity(56)).toBe(full)
    const aeroShare = async (hoursAgo: number) => {
      const reader = readerAt({ epochTimestamp: NOW - hoursAgo * HOUR })
      const [held] = await reader.readLpHoldings(aero, [SYNTHETIC_OWNERS[0]!])
      if (held === undefined) throw new Error('no holding')
      return Number(held.balance + held.staked) / Number(held.totalSupply)
    }
    expect(await aeroShare(0)).toBeLessThan(0.6)
    expect(await aeroShare(20)).toBeGreaterThan(0.85)
  })

  it('carries position logs so readPositions over each 2 h step sees every rebalanced position', async () => {
    const pools = await discoverAll(
      readerAt({ epochTimestamp: NOW }),
      SYNTHETIC_DEFAULTS.latestBlock,
    )
    const concentrated = pools.filter((p) => p.kind === 'concentrated')
    const prev = readerAt({ epochTimestamp: NOW - 4 * HOUR })
    const next = readerAt({ epochTimestamp: NOW - 2 * HOUR })
    const fromBlock = (await prev.getLatestBlock()).number + 1n
    const toBlock = (await next.getLatestBlock()).number
    const world = syntheticWorld({ epochTimestamp: NOW - 2 * HOUR })
    for (const pool of concentrated) {
      const synthetic = world.pools.find((p) => p.meta.id === pool.id)
      if (synthetic?.kind !== 'concentrated') throw new Error('pool missing')
      const touched = await next.readPositions(pool, { fromBlock, toBlock })
      // The Slipstream market maker keeps its liquidity outside its dip: not touched.
      const moving = synthetic.positions.filter(
        (p) => pool.id !== SYNTHETIC_POOL_IDS.wethUsdcSlipstream || p.holder === p.owner,
      )
      expect(touched.map((p) => [p.tokenId, p.liquidity])).toEqual(
        moving.map((p) => [p.tokenId, p.liquidity]),
      )
      const all = await next.readPositions(pool, { fromBlock: pool.createdAtBlock, toBlock })
      expect(all.map((p) => p.liquidity)).toEqual(synthetic.positions.map((p) => p.liquidity))
    }
  })

  it('serves the 24 h of swaps before the epoch, shared between overlapping epochs, by hour', async () => {
    const epoch = NOW - 10 * HOUR
    const reader = readerAt({ epochTimestamp: epoch })
    const world = syntheticWorld({ epochTimestamp: epoch })
    const pools = world.pools.map((p) => p.meta)
    const latest = await reader.getLatestBlock()
    const swaps = await reader.readSwaps(pools, latest.number - 50_000n, latest.number)
    expect(swaps).toHaveLength(world.pools.reduce((n, p) => n + p.swapCount, 0))
    const perHour = new Map<number, number>()
    for (const s of swaps) {
      const ts = s.timestamp as number
      expect(ts).toBeGreaterThanOrEqual(epoch - DAY)
      expect(ts).toBeLessThanOrEqual(epoch)
      const hour = Math.floor(ts / HOUR)
      perHour.set(hour, (perHour.get(hour) ?? 0) + 1)
      expect(s.amount0 > 0n !== s.amount1 > 0n).toBe(true)
    }
    const counts = [...perHour.values()]
    expect(Math.max(...counts)).toBeGreaterThan(2 * Math.min(...counts))
    // The same hour holds the same swaps in a later epoch's fixture.
    const later = readerAt({ epochTimestamp: epoch + 2 * HOUR })
    const overlap = await later.readSwaps(pools, latest.number - 30_000n, latest.number)
    const key = (s: (typeof swaps)[number]) => `${s.poolId}:${s.blockNumber}:${s.txHash}`
    const earlier = new Set(swaps.map(key))
    expect(overlap.length).toBeGreaterThan(100)
    for (const s of overlap) expect(earlier.has(key(s))).toBe(true)
  })
})
