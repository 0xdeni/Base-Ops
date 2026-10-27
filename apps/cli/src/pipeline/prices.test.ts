import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  type DepthLevel,
  getTickAtSqrtRatio,
  NATIVE_ETH,
  type PoolMeta,
  priceToSqrtPriceX96,
  type TokenInfo,
} from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import {
  buildPriceEdges,
  computePrices,
  derivePricesTwoPass,
  edgeWeight,
  overviewState,
  type PoolPriceEdge,
  PROXY_TICK_SPAN,
  priceEntries,
  pricingFor,
  usdEdgeWeight,
  usdOf,
  WRAP_EDGE_SOURCE,
} from './prices.js'

const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
})
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
const ETH = token(NATIVE_ETH, 'ETH', 18)
const AERO = token('0x940181a94a35a4569e4529a3cdfb74e38fd98631', 'AERO', 18)
const XYZ = token('0x00000000000000000000000000000000000000ff', 'XYZ', 18)
const ANCHORS: Record<Address, number> = { [USDC.address]: 1 }

function meta(
  partial: Partial<PoolMeta> & Pick<PoolMeta, 'id' | 'dex' | 'kind' | 'token0' | 'token1'>,
): PoolMeta {
  return {
    address: '0x0000000000000000000000000000000000000001',
    poolId: null,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks: null,
    createdAtBlock: 1n,
    ...partial,
  }
}

function concentrated(
  id: string,
  token0: TokenInfo,
  token1: TokenInfo,
  price: number,
  liquidity: bigint,
): PoolOverview {
  const sqrtPriceX96 = priceToSqrtPriceX96(price, token0.decimals, token1.decimals)
  return {
    pool: meta({ id, dex: 'uniswap-v3', kind: 'concentrated', token0, token1 }),
    blockNumber: 100n,
    sqrtPriceX96,
    tick: getTickAtSqrtRatio(sqrtPriceX96),
    liquidity,
    reserve0: 0n,
    reserve1: 0n,
  }
}

function volatile(
  id: string,
  token0: TokenInfo,
  token1: TokenInfo,
  reserve0: bigint,
  reserve1: bigint,
): PoolOverview {
  return {
    pool: meta({
      id,
      dex: 'aerodrome-v2',
      kind: 'constant-product',
      token0,
      token1,
      feePips: 3000,
      tickSpacing: null,
    }),
    blockNumber: 100n,
    sqrtPriceX96: null,
    tick: null,
    liquidity: null,
    reserve0,
    reserve1,
  }
}

describe('overviewState / pricingFor', () => {
  it('builds an exact state for reserve pools and a constant-liquidity proxy for concentrated ones', () => {
    const v2 = volatile(
      'aerodrome-v2:0xa',
      USDC,
      AERO,
      1_500_000n * 10n ** 6n,
      1_250_000n * 10n ** 18n,
    )
    expect(overviewState(v2)).toMatchObject({ kind: 'constant-product', feePips: 3000 })
    const p2 = pricingFor(v2)
    expect(p2.proxy).toBe(false)
    expect(p2.price).toBeCloseTo(1.2 / 1.44, 6)
    // Constant product: 2 % up needs reserve1 × (√1.02 − 1) ≈ 0.995 % of reserve1 (before fees).
    expect(edgeWeight(p2) / 1_250_000).toBeGreaterThan(0.0099)
    expect(edgeWeight(p2) / 1_250_000).toBeLessThan(0.0101)

    const v3 = concentrated('uniswap-v3:0xb', WETH, USDC, 2500, 3n * 10n ** 18n)
    const state = overviewState(v3)
    expect(state).toMatchObject({
      kind: 'concentrated',
      ticks: [],
      tickLowerBound: v3.tick! - PROXY_TICK_SPAN,
      tickUpperBound: v3.tick! + PROXY_TICK_SPAN,
    })
    const p3 = pricingFor(v3)
    expect(p3.proxy).toBe(true)
    expect(p3.price).toBeCloseTo(2500, 6)
    expect(p3.depth?.up.reached).toBe(true)
    expect(p3.depth?.down.reached).toBe(true)
    // Δtoken1 = L · √P · (√1.02 − 1) / 2^96 in raw units → human USDC.
    const expected = (3 * Math.sqrt(2500e-12) * (Math.sqrt(1.02) - 1) * 1e18) / 1e6
    expect(edgeWeight(p3) / expected).toBeGreaterThan(0.99)
    expect(edgeWeight(p3) / expected).toBeLessThan(1.01)
  })

  it('uses the full state when given and yields no edge for an empty pool', () => {
    const v3 = concentrated('uniswap-v3:0xb', WETH, USDC, 2500, 3n * 10n ** 18n)
    const full = {
      ...(overviewState(v3) as Exclude<ReturnType<typeof overviewState>, null>),
      liquidity: 6n * 10n ** 18n,
    }
    const exact = pricingFor(v3, full)
    expect(exact.proxy).toBe(false)
    expect(edgeWeight(exact) / edgeWeight(pricingFor(v3))).toBeCloseTo(2, 3)

    const empty = concentrated('uniswap-v3:0xc', WETH, USDC, 2500, 0n)
    expect(buildPriceEdges([pricingFor(empty)])).toEqual([])
    const unreadable = { ...empty, sqrtPriceX96: null }
    expect(pricingFor(unreadable)).toMatchObject({ state: null, price: null, depth: null })
  })
})

/** A pool edge with `upToken1` of token1 on the up side and (by default) as much on the down side. */
function sided(
  token0: Address,
  token1: Address,
  price: number,
  upToken1: number,
  source: string,
  downToken0 = upToken1 / price,
): PoolPriceEdge {
  const weight = Math.min(upToken1, downToken0 * price)
  return { token0, token1, price, weight, source, upToken1, downToken0 }
}

describe('computePrices', () => {
  const pools = [
    concentrated('uniswap-v3:0x1', WETH, USDC, 2500, 3n * 10n ** 18n),
    volatile('aerodrome-v2:0x2', USDC, AERO, 1_500_000n * 10n ** 6n, 1_250_000n * 10n ** 18n),
    // XYZ is only priced through ETH: 1 XYZ = 0.001 ETH.
    concentrated('uniswap-v4:0x3', XYZ, ETH, 0.001, 10n ** 18n),
  ]

  it('prices every token reachable from the anchors, tying native ETH to WETH', () => {
    const prices = computePrices(pools, ANCHORS, { wrappedNative: WETH.address })
    expect(usdOf(prices, USDC.address)).toBe(1)
    expect(usdOf(prices, WETH.address)).toBeCloseTo(2500, 3)
    expect(usdOf(prices, NATIVE_ETH)).toBeCloseTo(2500, 3)
    expect(usdOf(prices, AERO.address)).toBeCloseTo(1.2, 6)
    expect(usdOf(prices, XYZ.address)).toBeCloseTo(2.5, 3)
    expect(prices.get(NATIVE_ETH)?.via).toEqual(['uniswap-v3:0x1', WRAP_EDGE_SOURCE])
    expect(prices.get(XYZ.address)?.via).toEqual([
      'uniswap-v3:0x1',
      WRAP_EDGE_SOURCE,
      'uniswap-v4:0x3',
    ])
  })

  it('leaves native ETH unpriced without the wrap edge when no ETH pool reaches an anchor', () => {
    const prices = computePrices(pools, ANCHORS)
    expect(usdOf(prices, WETH.address)).toBeCloseTo(2500, 3)
    expect(usdOf(prices, NATIVE_ETH)).toBeNull()
    expect(usdOf(prices, XYZ.address)).toBeNull()
  })

  it('prefers the route that is deepest in USD, not in token units', () => {
    // Two WETH/USDC routes: a direct pool worth 1 000 USDC of 2 % depth a side and a WETH/AERO
    // pool worth 100 000 AERO (= 120 000 USD) a side behind a USDC/AERO pool worth 2 000 000 USDC.
    const edges = [
      sided(WETH.address, USDC.address, 2500, 1_000, 'direct'),
      sided(WETH.address, AERO.address, 2083.333, 100_000, 'weth-aero'),
      sided(AERO.address, USDC.address, 1.2, 2_000_000, 'aero-usdc'),
    ]
    const prices = derivePricesTwoPass(edges, ANCHORS)
    expect(prices.get(WETH.address)?.via).toEqual(['aero-usdc', 'weth-aero'])
    expect(usdOf(prices, WETH.address)).toBeCloseTo(2500, 0)
    expect(prices.get(WETH.address)?.weight).toBeCloseTo(120_000, -1)
  })

  it('weighs an edge by its thinner side in both passes', () => {
    // The same WETH/USDC depth, once with a thin sell side (0.4 WETH = 1 000 USD).
    const thin = sided(WETH.address, USDC.address, 2500, 50_000, 'thin', 0.4)
    const even = sided(WETH.address, USDC.address, 2500, 5_000, 'even')
    expect(derivePricesTwoPass([thin, even], ANCHORS).get(WETH.address)?.via).toEqual(['even'])
    expect(usdEdgeWeight(thin, 2500, 1)).toBeCloseTo(1_000, 6)
    expect(thin.weight).toBeCloseTo(1_000, 6)
    expect(usdEdgeWeight({ ...thin, downToken0: 0 }, 2500, 1)).toBe(0)
  })

  it('serialises entries sorted by token', () => {
    const prices = computePrices(pools, ANCHORS, { wrappedNative: WETH.address })
    const entries = priceEntries(prices)
    expect(entries.map((e) => e.token)).toEqual([...entries.map((e) => e.token)].sort())
    expect(entries.find((e) => e.token === USDC.address)).toEqual({
      token: USDC.address,
      usd: 1,
      via: [],
    })
  })
})

describe('depth level shape', () => {
  it('exposes raw bigint amounts on the proxy depth', () => {
    const level = pricingFor(concentrated('uniswap-v3:0x1', WETH, USDC, 2500, 10n ** 18n))
      .depth as DepthLevel
    expect(typeof level.up.amountIn).toBe('bigint')
    expect(level.up.amountIn).toBeGreaterThan(0n)
    expect(level.down.amountIn).toBeGreaterThan(0n)
  })
})
