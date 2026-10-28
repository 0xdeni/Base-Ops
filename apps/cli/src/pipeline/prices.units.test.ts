/**
 * Edge weights are in USD whatever the tokens' units (docs/METRICS.md, "USD prices"): a stale pool
 * against a cheap token cannot outweigh a deep pool by counting its cheap side in token units, and
 * re-denominating a token changes no route. Hooked Uniswap v4 pools are no route at all.
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  derivePrices,
  getTickAtSqrtRatio,
  type PoolMeta,
  type PriceEdge,
  priceToSqrtPriceX96,
  type TokenInfo,
} from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { buildPriceEdges, computePrices, depthSides, pricingFor, usdOf } from './prices.js'

const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
})
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
const A = token('0x00000000000000000000000000000000000000a0', 'A', 18)
const B = token('0x00000000000000000000000000000000000000b0', 'B', 18)
const ANCHORS: Record<Address, number> = { [USDC.address]: 1 }

function reservePool(
  id: string,
  token0: TokenInfo,
  token1: TokenInfo,
  reserve0: bigint,
  reserve1: bigint,
): PoolOverview {
  const pool: PoolMeta = {
    id,
    dex: 'aerodrome-v2',
    kind: 'constant-product',
    address: `0x${id.slice(-40)}` as Address,
    poolId: null,
    token0,
    token1,
    feePips: 3000,
    tickSpacing: null,
    stable: false,
    hooks: null,
    createdAtBlock: 1n,
  }
  return {
    pool,
    blockNumber: 100n,
    sqrtPriceX96: null,
    tick: null,
    liquidity: null,
    reserve0,
    reserve1,
  }
}

const E18 = 10n ** 18n
const E6 = 10n ** 6n
// A is worth $100 (A/USDC), B $0.0001 (B/USDC); the stale A/B pool quotes A at 1,000 B ($0.10).
const A_USDC = reservePool(
  'aerodrome-v2:0x00000000000000000000000000000000000000a1',
  A,
  USDC,
  800n * E18,
  80_000n * E6,
)
const B_USDC = reservePool(
  'aerodrome-v2:0x00000000000000000000000000000000000000b1',
  B,
  USDC,
  1_000_000_000n * E18,
  100_000n * E6,
)
const STALE_A_B = reservePool(
  'aerodrome-v2:0x00000000000000000000000000000000000000ab',
  A,
  B,
  2_000n * E18,
  2_000_000n * E18,
)

describe('a stale pool against a cheap token', () => {
  it('does not outweigh the deep pool: A is priced at $100 through A/USDC', () => {
    const prices = computePrices([A_USDC, B_USDC, STALE_A_B], ANCHORS)
    expect(usdOf(prices, B.address)).toBeCloseTo(0.0001, 9)
    const a = prices.get(A.address)
    expect(a?.usd).toBeCloseTo(100, 6)
    expect(a?.via).toEqual([A_USDC.pool.id])
    expect(a?.weight).toBeGreaterThan(790)
    expect(a?.weight).toBeLessThan(810)
  })

  it('weighs the stale pool about $2 when reached from B, though it holds 19,900 B a side', () => {
    const stale = depthSides(pricingFor(STALE_A_B))
    expect(stale.upToken1).toBeGreaterThan(19_900)
    // Only the stale pool reaches A: its weight is its thinner side at B's price and its own.
    const prices = computePrices([B_USDC, STALE_A_B], ANCHORS)
    expect(prices.get(A.address)?.usd).toBeCloseTo(0.1, 9)
    expect(prices.get(A.address)?.weight).toBeGreaterThan(1.9)
    expect(prices.get(A.address)?.weight).toBeLessThan(2.1)
  })
})

describe('re-denominating a token', () => {
  /** WETH/USDC, a WETH/B pool and a B/USDC pool, with B's amounts × k and its price ÷ k. */
  function graph(k: number): PriceEdge[] {
    return [
      {
        token0: WETH.address,
        token1: USDC.address,
        price: 2500,
        upToken1: 40_000,
        downToken0: 16,
        source: 'weth-usdc',
      },
      {
        token0: WETH.address,
        token1: B.address,
        price: 2.5e7 * k,
        upToken1: 1e9 * k,
        downToken0: 50,
        source: 'weth-b',
      },
      {
        token0: B.address,
        token1: USDC.address,
        price: 1e-4 / k,
        upToken1: 30_000,
        downToken0: 3e8 * k,
        source: 'b-usdc',
      },
    ]
  }

  it('changes no route and no other price; B is priced ÷ k', () => {
    const base = derivePrices(graph(1), ANCHORS)
    // B is reached through WETH: the WETH/B pool's bottleneck beats the B/USDC pool's.
    expect(base.get(B.address)?.via).toEqual(['weth-usdc', 'weth-b'])
    for (const k of [1e-9, 1e-3, 1e3, 1e12]) {
      const scaled = derivePrices(graph(k), ANCHORS)
      for (const address of [WETH.address, B.address]) {
        expect(scaled.get(address)?.via).toEqual(base.get(address)?.via)
        const ratio = (scaled.get(address)?.weight ?? 0) / (base.get(address)?.weight ?? 1)
        expect(ratio).toBeCloseTo(1, 9)
      }
      expect((usdOf(scaled, WETH.address) ?? 0) / (usdOf(base, WETH.address) ?? 1)).toBeCloseTo(
        1,
        9,
      )
      expect(((usdOf(scaled, B.address) ?? 0) * k) / (usdOf(base, B.address) ?? 1)).toBeCloseTo(
        1,
        9,
      )
    }
  })
})

describe('a hooked Uniswap v4 pool', () => {
  it('is no price edge, though its state would give depth on both sides', () => {
    const sqrtPriceX96 = priceToSqrtPriceX96(2500, 18, 6)
    const view: PoolOverview = {
      pool: {
        id: `uniswap-v4:0x${'cd'.repeat(32)}`,
        dex: 'uniswap-v4',
        kind: 'concentrated',
        address: null,
        poolId: `0x${'cd'.repeat(32)}`,
        token0: WETH,
        token1: USDC,
        feePips: 500,
        tickSpacing: 10,
        stable: false,
        hooks: '0x00000000000000000000000000000000000000c0',
        createdAtBlock: 1n,
      },
      blockNumber: 100n,
      sqrtPriceX96,
      tick: getTickAtSqrtRatio(sqrtPriceX96),
      liquidity: 10n ** 18n,
      reserve0: 0n,
      reserve1: 0n,
    }
    const pricing = pricingFor(view)
    expect(depthSides(pricing).upToken1).toBeGreaterThan(0)
    expect(depthSides(pricing).downToken0).toBeGreaterThan(0)
    expect(buildPriceEdges([pricing])).toEqual([])
    const unhooked = { ...view, pool: { ...view.pool, hooks: `0x${'0'.repeat(40)}` as Address } }
    expect(buildPriceEdges([pricingFor(unhooked)])).toHaveLength(1)
    expect(usdOf(computePrices([view], ANCHORS), WETH.address)).toBeNull()
  })
})
