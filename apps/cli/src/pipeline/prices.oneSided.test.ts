/**
 * Regression for the live run at block 53,063,332: BRETT was priced at $17.96 instead of ~$0.0047
 * because a Uniswap v3 BRETT/USDC 0.3 % pool with no active liquidity, and liquidity only above
 * its stale price (2 % up: 32,059 USDC; 2 % down: nothing), out-weighed the real WETH route when
 * edges were weighted by their up side alone. Weighted by the thinner side, that pool is no route,
 * and its snapshot flags the quote as stale (docs/METRICS.md, "Stale quotes").
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  buildConcentratedState,
  getTickAtSqrtRatio,
  isStaleQuote,
  type PoolMeta,
  priceToSqrtPriceX96,
  type TokenInfo,
} from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { buildPriceEdges, computePrices, depthSides, pricingFor } from './prices.js'
import { buildSnapshot } from './snapshot.js'

const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
})
const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
const BRETT = token('0x532f27101965dd16442e59d40670faf5ebb142e4', 'BRETT', 18)
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
const ANCHORS: Record<Address, number> = { [USDC.address]: 1 }

const WETH_USD = 3_900
const BRETT_USD = 0.0047

function overview(
  id: string,
  token0: TokenInfo,
  token1: TokenInfo,
  price: number,
  liquidity: bigint,
  feePips: number,
  tickSpacing: number,
): PoolOverview {
  const sqrtPriceX96 = priceToSqrtPriceX96(price, token0.decimals, token1.decimals)
  const pool: PoolMeta = {
    id,
    dex: 'uniswap-v3',
    kind: 'concentrated',
    address: `0x${id.slice(-40)}` as Address,
    poolId: null,
    token0,
    token1,
    feePips,
    tickSpacing,
    stable: false,
    hooks: null,
    createdAtBlock: 1n,
  }
  return {
    pool,
    blockNumber: 53_063_332n,
    sqrtPriceX96,
    tick: getTickAtSqrtRatio(sqrtPriceX96),
    liquidity,
    reserve0: 0n,
    reserve1: 0n,
  }
}

const WETH_USDC = overview(
  'uniswap-v3:0x00000000000000000000000000000000000000a1',
  WETH,
  USDC,
  WETH_USD,
  10n ** 19n,
  500,
  10,
)
const WETH_BRETT = overview(
  'uniswap-v3:0x00000000000000000000000000000000000000a2',
  WETH,
  BRETT,
  WETH_USD / BRETT_USD,
  10n ** 23n,
  10_000,
  200,
)
const ONE_SIDED = overview(
  'uniswap-v3:0xcfe206d9880c5f16b6822ce1b95be59d2fec6e77',
  BRETT,
  USDC,
  17.96,
  0n,
  3_000,
  60,
)

/** The one-sided pool as `readState` sees it: no active liquidity, one range just above the price. */
function oneSidedState() {
  const tick = ONE_SIDED.tick as number
  const aligned = Math.floor(tick / 60) * 60
  return buildConcentratedState({
    positions: [
      { tickLower: aligned + 60, tickUpper: aligned + 1_200, liquidity: 77n * 10n ** 16n },
    ],
    tick,
    feePips: 3_000,
    tickSpacing: 60,
    tickLowerBound: tick - 2_000,
    tickUpperBound: tick + 2_000,
  })
}

describe('a one-sided pool is not a price route', () => {
  const states = new Map([[ONE_SIDED.pool.id, oneSidedState()]])

  it('has depth on its up side only, so it is no price edge', () => {
    const pricing = pricingFor(ONE_SIDED, states.get(ONE_SIDED.pool.id))
    expect(pricing.price).toBeCloseTo(17.96, 2)
    expect(pricing.state).toMatchObject({ liquidity: 0n })
    const { upToken1, downToken0 } = depthSides(pricing)
    expect(upToken1).toBeGreaterThan(25_000) // ≈ 32,000 USDC, as measured on Base
    expect(upToken1).toBeLessThan(40_000)
    expect(downToken0).toBe(0)
    expect(buildPriceEdges([pricing])).toEqual([])
  })

  it('prices BRETT through the WETH route, as every two-sided BRETT pool does', () => {
    const views = [WETH_USDC, WETH_BRETT, ONE_SIDED]
    const prices = computePrices(views, ANCHORS, { states })
    const brett = prices.get(BRETT.address)
    expect(brett?.usd).toBeCloseTo(BRETT_USD, 6)
    expect(brett?.via).toEqual([WETH_USDC.pool.id, WETH_BRETT.pool.id])
    // The route is thinner than the stale pool's up side, which used to win on that side alone.
    const stale = depthSides(pricingFor(ONE_SIDED, states.get(ONE_SIDED.pool.id))).upToken1
    expect(brett?.weight).toBeLessThan(stale)
    expect(brett?.weight).toBeGreaterThan(1_000)
  })

  it('records the stale quote on its snapshot, and none on the route it no longer beats', () => {
    const prices = computePrices([WETH_USDC, WETH_BRETT, ONE_SIDED], ANCHORS, { states })
    const state = oneSidedState()
    const stale = buildSnapshot(ONE_SIDED.pool, ONE_SIDED, state, prices, null, 5)
    // 17.96 USDC per BRETT against BRETT at $0.0047: about 3.8 × 10^7 bps off.
    expect(stale.priceDeviationBps).toBeGreaterThan(3.8e7)
    expect(stale.priceDeviationBps).toBeLessThan(3.9e7)
    expect(isStaleQuote(stale.priceDeviationBps)).toBe(true)
    // Its depth is still measured, at its own price: the up side alone.
    expect(stale.depthUsd.find((level) => level.pct === 2)?.upUsd).toBeGreaterThan(25_000)
    const route = pricingFor(WETH_BRETT)
    if (route.state === null) throw new Error('no proxy state')
    const onRoute = buildSnapshot(WETH_BRETT.pool, WETH_BRETT, route.state, prices, null, 5)
    expect(onRoute.priceDeviationBps).toBeLessThan(1)
    expect(isStaleQuote(onRoute.priceDeviationBps)).toBe(false)
  })
})
