/**
 * `buildSnapshot` on one pool's state: a hooked Uniswap v4 pool keeps its price but gets no depth,
 * spread or concentration (docs/METRICS.md, `hooked`), and every snapshot records how far its
 * price is from its tokens' USD cross (`priceDeviationBps`, "Stale quotes").
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  buildConcentratedState,
  getTickAtSqrtRatio,
  type PoolMeta,
  priceToSqrtPriceX96,
  type TokenInfo,
} from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { computePrices } from './prices.js'
import { buildSnapshot } from './snapshot.js'

const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
})
const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
const POOL_ID = `0x${'cd'.repeat(32)}` as const

function v4Pool(hooks: Address | null): PoolMeta {
  return {
    id: `uniswap-v4:${POOL_ID}`,
    dex: 'uniswap-v4',
    kind: 'concentrated',
    address: null,
    poolId: POOL_ID,
    token0: WETH,
    token1: USDC,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks,
    createdAtBlock: 1n,
  }
}

/** A WETH/USDC pool at `price` with liquidity in ±20 % of it. */
function poolAt(pool: PoolMeta, price: number) {
  const sqrtPriceX96 = priceToSqrtPriceX96(price, 18, 6)
  const tick = getTickAtSqrtRatio(sqrtPriceX96)
  const aligned = Math.floor(tick / 10) * 10
  const state = buildConcentratedState({
    positions: [{ tickLower: aligned - 2_000, tickUpper: aligned + 2_000, liquidity: 10n ** 17n }],
    tick,
    feePips: 500,
    tickSpacing: 10,
    tickLowerBound: aligned - 4_000,
    tickUpperBound: aligned + 4_000,
  })
  const view: PoolOverview = {
    pool,
    blockNumber: state.blockNumber,
    sqrtPriceX96,
    tick,
    liquidity: state.liquidity,
    reserve0: 0n,
    reserve1: 0n,
  }
  return { view, state: { ...state, sqrtPriceX96 } }
}

const ANCHORS: Record<Address, number> = { [USDC.address]: 1 }
// WETH = $2,500 through a plain (unhooked) WETH/USDC pool.
const ROUTE = poolAt(
  { ...v4Pool(null), id: 'uniswap-v4:route', poolId: `0x${'ab'.repeat(32)}` },
  2500,
)
const PRICES = computePrices([ROUTE.view], ANCHORS)

describe('buildSnapshot', () => {
  it('measures a plain v4 pool and records a deviation of about 0 at the market price', () => {
    const { view, state } = poolAt(v4Pool(null), 2500)
    const snapshot = buildSnapshot(view.pool, view, state, PRICES, null, 5)
    expect(snapshot.depth).toHaveLength(3)
    expect(snapshot.depthUsd.find((level) => level.pct === 2)?.upUsd).toBeGreaterThan(0)
    expect(snapshot.spreads.length).toBeGreaterThan(0)
    expect(snapshot.concentration).not.toBeNull()
    expect(snapshot.priceDeviationBps).toBeLessThan(1)
  })

  it('stores a hooked v4 pool with its price and no depth, spread or concentration', () => {
    const { view, state } = poolAt(v4Pool('0x00000000000000000000000000000000000000c0'), 2500)
    const snapshot = buildSnapshot(view.pool, view, state, PRICES, null, 5)
    expect(snapshot.price).toBeCloseTo(2500, 6)
    expect(snapshot.token0Usd).toBeCloseTo(2500, 6)
    expect(snapshot).toMatchObject({ depth: [], depthUsd: [], spreads: [], concentration: null })
    expect(snapshot.priceDeviationBps).toBeLessThan(1)
  })

  it('records the deviation of a pool quoting 10 % above the market', () => {
    const { view, state } = poolAt(v4Pool(null), 2750)
    const snapshot = buildSnapshot(view.pool, view, state, PRICES, null, 5)
    expect(snapshot.priceDeviationBps).toBeGreaterThan(999)
    expect(snapshot.priceDeviationBps).toBeLessThan(1_001)
    const unpriced = buildSnapshot(view.pool, view, state, new Map(), null, 5)
    expect(unpriced.priceDeviationBps).toBeNull()
  })
})
