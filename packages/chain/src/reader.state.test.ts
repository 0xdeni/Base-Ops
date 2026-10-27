import { getSqrtRatioAtTick, Q96 } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aerodromePoolFactoryAbi } from './abi/aerodromePoolFactory.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { registerCall } from './fixtures/builders.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import {
  addr,
  type ConcentratedSpec,
  countingTransport,
  findCause,
  newFixture,
  poolMeta,
  registerConcentratedPool,
  registerV2Pool,
  registerV4Pool,
  TOKEN_A,
  TOKEN_D,
} from './test/helpers.js'
import { createFixtureTransport, type Fixture, FixtureMissError } from './transport/fixture.js'

function reader(fixture: Fixture, opts: CreateChainReaderOptions = {}) {
  const counts = new Map<string, number>()
  const r = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
    ...opts,
  })
  return { r, counts }
}

const LATEST = 10_000n
const LATEST_TS = 1_800_000_000
const tsOf = (block: bigint) => LATEST_TS - Number(LATEST - block) * 2

describe('readOverview', () => {
  it('batches every DEX through Multicall3 in groups of maxCallsPerMulticall, keeping input order', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    const block = 1_000n
    const mk = (i: number): ConcentratedSpec => ({
      sqrtPriceX96: Q96 * BigInt(i + 1),
      tick: i * 10,
      liquidity: BigInt(i) * 1_000n + 1n,
      feePips: 500,
      tickSpacing: 10,
      reserve0: BigInt(i) * 7n,
      reserve1: BigInt(i) * 11n,
    })
    const v3 = [0x301, 0x302, 0x303].map((n, i) => {
      const pool = poolMeta({
        dex: 'uniswap-v3',
        address: addr(n),
        token0: TOKEN_A,
        token1: TOKEN_D,
        feePips: 500,
        tickSpacing: 10,
      })
      registerConcentratedPool(fixture, pool, mk(i), [block])
      return pool
    })
    const slip = poolMeta({
      dex: 'aerodrome-slipstream',
      address: addr(0x304),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 100,
    })
    registerConcentratedPool(fixture, slip, mk(3), [block])
    const v2a = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x305),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    const v2b = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x306),
      token0: TOKEN_A,
      token1: TOKEN_D,
      stable: true,
    })
    registerV2Pool(fixture, v2a, { reserve0: 11n, reserve1: 22n }, [block])
    registerV2Pool(fixture, v2b, { reserve0: 33n, reserve1: 44n }, [block])
    const v4 = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    registerV4Pool(fixture, A.uniswapV4.stateView, v4, mk(4), [block])

    const pools = [v3[0]!, v2a, v4, v3[1]!, slip, v2b, v3[2]!]
    const { r, counts } = reader(fixture, { maxCallsPerMulticall: 5 })
    const views = await r.readOverview(pools, block)
    expect(views.map((v) => v.pool.id)).toEqual(pools.map((p) => p.id))
    expect(views.every((v) => v.blockNumber === block)).toBe(true)
    expect(views[0]).toMatchObject({
      sqrtPriceX96: Q96,
      tick: 0,
      liquidity: 1n,
      reserve0: 0n,
      reserve1: 0n,
    })
    expect(views[3]).toMatchObject({
      sqrtPriceX96: Q96 * 2n,
      tick: 10,
      liquidity: 1_001n,
      reserve0: 7n,
      reserve1: 11n,
    })
    expect(views[4]).toMatchObject({
      sqrtPriceX96: Q96 * 4n,
      tick: 30,
      liquidity: 3_001n,
      reserve0: 21n,
      reserve1: 33n,
    })
    expect(views[1]).toEqual({
      pool: v2a,
      blockNumber: block,
      sqrtPriceX96: null,
      tick: null,
      liquidity: null,
      reserve0: 11n,
      reserve1: 22n,
    })
    expect(views[5]).toMatchObject({ reserve0: 33n, reserve1: 44n })
    // v4: StateView slot0/liquidity; reserves are not readable per pool and reported as 0n.
    expect(views[2]).toEqual({
      pool: v4,
      blockNumber: block,
      sqrtPriceX96: Q96 * 5n,
      tick: 40,
      liquidity: 4_001n,
      reserve0: 0n,
      reserve1: 0n,
    })
    // v3: 12 calls → 5 + 5 + 2; slipstream 4 → 1; v2 2 → 1; v4 2 → 1
    expect(counts.get('eth_call')).toBe(6)
    expect(counts.get('eth_getBlockByNumber')).toBeUndefined()
    expect(await r.readOverview([])).toEqual([])
  })

  it('defaults to the latest block', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    const v2 = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x307),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    registerV2Pool(fixture, v2, { reserve0: 1n, reserve1: 2n }, [LATEST])
    const { r, counts } = reader(fixture)
    const [view] = await r.readOverview([v2])
    expect(view).toMatchObject({ blockNumber: LATEST, reserve0: 1n, reserve1: 2n })
    expect(counts.get('eth_getBlockByNumber')).toBe(1)
    expect(await r.getLatestBlock()).toEqual({ number: LATEST, timestamp: LATEST_TS })
    expect(await r.getBlockTimestamp(LATEST - 5n)).toBe(LATEST_TS - 10)
  })
})

/** Ticks -2560 and -10 live in word -1 (bits 0 and 255); 0 and 2550 in word 0 (bits 0 and 255). */
const twoWords: ConcentratedSpec = {
  sqrtPriceX96: getSqrtRatioAtTick(-5),
  tick: -5,
  liquidity: 300n,
  feePips: 500,
  tickSpacing: 10,
  bitmaps: { [-1]: (1n << 255n) | 1n, 0: 1n | (1n << 255n) },
  ticks: { [-2560]: [100n, 100n], [-10]: [200n, 200n], 0: [300n, -300n], 2550: [100n, -100n] },
}
const expectedTicks = [
  { index: -2560, liquidityGross: 100n, liquidityNet: 100n },
  { index: -10, liquidityGross: 200n, liquidityNet: 200n },
  { index: 0, liquidityGross: 300n, liquidityNet: -300n },
  { index: 2550, liquidityGross: 100n, liquidityNet: -100n },
]

describe('readState', () => {
  it('uniswap-v3: walks the bitmap words around the tick and reports word edges as bounds', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    // tickSpacing in the meta is deliberately wrong: the walk uses the on-chain value.
    const pool = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x310),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 60,
    })
    registerConcentratedPool(fixture, pool, twoWords, [500n])
    const { r, counts } = reader(fixture)
    const state = await r.readState(pool, { bandPct: 5, blockNumber: 500n })
    expect(state).toEqual({
      kind: 'concentrated',
      blockNumber: 500n,
      timestamp: tsOf(500n),
      sqrtPriceX96: getSqrtRatioAtTick(-5),
      tick: -5,
      liquidity: 300n,
      feePips: 500,
      tickSpacing: 10,
      ticks: expectedTicks,
      tickLowerBound: -2560,
      tickUpperBound: 2559,
    })
    expect(counts.get('eth_call')).toBe(3) // base reads, bitmap words, ticks
    expect(counts.get('eth_getBlockByNumber')).toBe(1)
  })

  it('reads exactly the words that cover the band', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    const pool = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x311),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    registerConcentratedPool(fixture, pool, { ...twoWords, bitmaps: { [-1]: 0n }, ticks: {} }, [
      500n,
    ])
    const { r } = reader(fixture)
    const err = await r.readState(pool, { bandPct: 5, blockNumber: 500n }).catch((e) => e)
    expect(findCause(err, (e) => e instanceof FixtureMissError)).toBeDefined()
    // A wider band needs words -2..1.
    registerConcentratedPool(
      fixture,
      pool,
      { ...twoWords, bitmaps: { [-2]: 0n, [-1]: 0n, 0: 0n, 1: 0n }, ticks: {} },
      [600n],
    )
    const wide = await r.readState(pool, { bandPct: 20, blockNumber: 600n })
    expect(wide).toMatchObject({ ticks: [], tickLowerBound: -5120, tickUpperBound: 5119 })
  })

  it('aerodrome-slipstream: same walk, 6-field slot0 and 10-field ticks(), live fee()', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    const pool = poolMeta({
      dex: 'aerodrome-slipstream',
      address: addr(0x312),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    registerConcentratedPool(fixture, pool, { ...twoWords, feePips: 1234 }, [LATEST])
    const { r } = reader(fixture)
    const state = await r.readState(pool, { bandPct: 5 })
    expect(state).toMatchObject({
      blockNumber: LATEST,
      timestamp: LATEST_TS,
      feePips: 1234,
      tickSpacing: 10,
      ticks: expectedTicks,
      tickLowerBound: -2560,
      tickUpperBound: 2559,
    })
  })

  it('uniswap-v4: StateView getSlot0/getLiquidity/getTickBitmap/getTickInfo', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    const pool = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    // protocolFee 512 125 = 125 pips each way (low 12 bits zeroForOne, high 12 bits oneForZero).
    const spec = { ...twoWords, feePips: 999, protocolFee: 125 | (125 << 12) }
    registerV4Pool(fixture, A.uniswapV4.stateView, pool, spec, [700n])
    const { r, counts } = reader(fixture)
    const state = await r.readState(pool, { bandPct: 5, blockNumber: 700n })
    expect(state).toEqual({
      kind: 'concentrated',
      blockNumber: 700n,
      timestamp: tsOf(700n),
      sqrtPriceX96: getSqrtRatioAtTick(-5),
      tick: -5,
      liquidity: 300n,
      feePips: 999,
      protocolFeePips: { zeroForOne: 125, oneForZero: 125 },
      tickSpacing: 10,
      ticks: expectedTicks,
      tickLowerBound: -2560,
      tickUpperBound: 2559,
    })
    expect(counts.get('eth_call')).toBe(3)
  })

  it('aerodrome-v2: reserves plus the factory fee, stable pools carry decimals', async () => {
    const fixture = newFixture(LATEST, LATEST_TS)
    const volatile = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x313),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    const stable = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x314),
      token0: TOKEN_A,
      token1: TOKEN_D,
      stable: true,
    })
    registerV2Pool(fixture, volatile, { reserve0: 10n ** 24n, reserve1: 10n ** 12n }, [800n])
    registerV2Pool(fixture, stable, { reserve0: 10n ** 24n, reserve1: 10n ** 12n }, [800n])
    const factory = A.aerodromeV2.poolFactory
    registerCall(fixture, {
      to: factory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getFee',
      args: [volatile.address, false],
      result: 30n,
      blocks: [800n],
    })
    registerCall(fixture, {
      to: factory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getFee',
      args: [stable.address, true],
      result: 5n,
      blocks: [800n],
    })
    const { r } = reader(fixture)
    expect(await r.readState(volatile, { bandPct: 5, blockNumber: 800n })).toEqual({
      kind: 'constant-product',
      blockNumber: 800n,
      timestamp: tsOf(800n),
      reserve0: 10n ** 24n,
      reserve1: 10n ** 12n,
      feePips: 3000,
    })
    expect(await r.readState(stable, { bandPct: 5, blockNumber: 800n })).toEqual({
      kind: 'stable-swap',
      blockNumber: 800n,
      timestamp: tsOf(800n),
      reserve0: 10n ** 24n,
      reserve1: 10n ** 12n,
      decimals0: 18,
      decimals1: 6,
      feePips: 500,
    })
  })
})
