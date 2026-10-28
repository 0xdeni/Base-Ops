import { describe, expect, it } from 'vitest'
import { derivePrices } from './pricing.js'
import type { Address, PriceEdge } from './types.js'

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address
const WETH = '0x4200000000000000000000000000000000000006' as Address
const AERO = '0x940181a94a35a4569e4529a3cdfb74e38fd98631' as Address
const DAI = '0x50c5725949a6f0c72e6c4a641f24049a917db0cb' as Address
const LONELY = '0x000000000000000000000000000000000000dead' as Address

function edge(
  token0: Address,
  token1: Address,
  price: number,
  weight: number,
  source: string,
): PriceEdge {
  return { token0, token1, price, weight, source }
}

describe('derivePrices', () => {
  it('prices a direct neighbour and inverts edges', () => {
    const edges = [edge(WETH, USDC, 3000, 100, 'weth-usdc')]
    const prices = derivePrices(edges, { [USDC]: 1 })
    expect(prices.get(USDC)).toEqual({ usd: 1, via: [], weight: Number.POSITIVE_INFINITY })
    expect(prices.get(WETH)).toEqual({ usd: 3000, via: ['weth-usdc'], weight: 100 })
    // the same pool with the tokens the other way round (USDC per... WETH per USDC)
    const inverted = derivePrices([edge(USDC, WETH, 1 / 3000, 100, 'usdc-weth')], { [USDC]: 1 })
    expect(inverted.get(WETH)?.usd).toBeCloseTo(3000, 9)
    expect(inverted.get(WETH)?.via).toEqual(['usdc-weth'])
  })

  it('routes multi-hop through the deepest (max-bottleneck) path', () => {
    const edges = [
      edge(WETH, USDC, 3000, 100, 'weth-usdc-deep'),
      edge(WETH, USDC, 3100, 10, 'weth-usdc-shallow'),
      edge(AERO, WETH, 0.001, 50, 'aero-weth'),
      edge(AERO, USDC, 2.9, 5, 'aero-usdc-shallow'),
    ]
    const prices = derivePrices(edges, { [USDC]: 1 })
    expect(prices.get(WETH)).toEqual({ usd: 3000, via: ['weth-usdc-deep'], weight: 100 })
    const aero = prices.get(AERO)
    expect(aero?.usd).toBeCloseTo(3, 9)
    expect(aero?.via).toEqual(['weth-usdc-deep', 'aero-weth'])
    expect(aero?.weight).toBe(50)
  })

  it('prefers a shallow direct edge over a deep route only when it is wider', () => {
    const edges = [
      edge(WETH, USDC, 3000, 100, 'weth-usdc'),
      edge(AERO, WETH, 0.001, 5, 'aero-weth'),
      edge(AERO, USDC, 2.9, 40, 'aero-usdc'),
    ]
    const aero = derivePrices(edges, { [USDC]: 1 }).get(AERO)
    expect(aero?.usd).toBeCloseTo(2.9, 9)
    expect(aero?.via).toEqual(['aero-usdc'])
    expect(aero?.weight).toBe(40)
  })

  it('leaves unreachable tokens absent and skips bad edges', () => {
    const edges = [
      edge(WETH, USDC, 3000, 100, 'weth-usdc'),
      edge(LONELY, DAI, 1, 100, 'lonely-dai'),
      edge(AERO, WETH, 0, 100, 'zero-price'),
      edge(AERO, WETH, 0.001, 0, 'zero-weight'),
      edge(AERO, WETH, Number.NaN, 100, 'nan-price'),
    ]
    const prices = derivePrices(edges, { [USDC]: 1 })
    expect(prices.has(LONELY)).toBe(false)
    expect(prices.has(DAI)).toBe(false)
    expect(prices.has(AERO)).toBe(false)
    expect(prices.size).toBe(2)
  })

  it('supports several anchors, keeps anchor prices and ignores address case', () => {
    const edges = [
      edge(WETH, USDC, 3000, 100, 'weth-usdc'),
      edge(WETH, DAI, 2990, 500, 'weth-dai'),
      edge(DAI, USDC, 0.5, 1000, 'bogus-dai-usdc'),
    ]
    const prices = derivePrices(edges, {
      [USDC]: 1,
      [DAI.toUpperCase().replace('0X', '0x') as Address]: 1,
    })
    expect(prices.get(DAI)?.usd).toBe(1)
    expect(prices.get(DAI)?.via).toEqual([])
    // WETH is reached from DAI through the deeper weth-dai pool
    expect(prices.get(WETH)).toEqual({ usd: 2990, via: ['weth-dai'], weight: 500 })
    const mixedCaseEdge = edge(
      WETH.toUpperCase().replace('0X', '0x') as Address,
      USDC,
      3000,
      1,
      'x',
    )
    expect(derivePrices([mixedCaseEdge], { [USDC]: 1 }).get(WETH)?.usd).toBe(3000)
  })

  it('accepts an edge without a usable weight or sides as no route', () => {
    const noWeight: PriceEdge = { token0: WETH, token1: USDC, price: 3000, source: 'none' }
    expect(derivePrices([noWeight], { [USDC]: 1 }).has(WETH)).toBe(false)
  })

  it('is deterministic on ties (first edge wins)', () => {
    const edges = [edge(WETH, USDC, 3000, 100, 'first'), edge(WETH, USDC, 3001, 100, 'second')]
    expect(derivePrices(edges, { [USDC]: 1 }).get(WETH)?.via).toEqual(['first'])
    expect(derivePrices([], { [USDC]: 1 }).size).toBe(1)
    expect(derivePrices(edges, {}).size).toBe(0)
  })
})

/** A pool edge with its ±2 % sides: `up` token1 and `down` token0, human. */
function sided(
  token0: Address,
  token1: Address,
  price: number,
  up: number,
  down: number,
  source: string,
): PriceEdge {
  return { token0, token1, price, upToken1: up, downToken0: down, source }
}

describe('derivePrices: edge weights in USD at relaxation', () => {
  it('weighs a sided edge by its thinner side, the settled side at its USD price', () => {
    // WETH/USDC at 3000: 600,000 USDC up, 50 WETH down (= $150,000 at the price this edge implies).
    const prices = derivePrices([sided(WETH, USDC, 3000, 600_000, 50, 'weth-usdc')], {
      [USDC]: 1,
    })
    expect(prices.get(WETH)).toEqual({ usd: 3000, via: ['weth-usdc'], weight: 150_000 })
    // Reached from token0: the same edge with the tokens the other way round.
    const flipped = derivePrices([sided(USDC, WETH, 1 / 3000, 50, 600_000, 'usdc-weth')], {
      [USDC]: 1,
    })
    expect(flipped.get(WETH)?.weight).toBeCloseTo(150_000, 6)
  })

  it('weighs a downstream edge at the USD price its settled token was given', () => {
    // AERO/WETH at 0.0004 WETH per AERO: 40 WETH up ($120,000), 200,000 AERO down ($240,000).
    const edges = [
      sided(WETH, USDC, 3000, 3_000_000, 1_000, 'weth-usdc'),
      sided(AERO, WETH, 0.0004, 40, 200_000, 'aero-weth'),
      sided(AERO, USDC, 1.2, 50_000, 50_000, 'aero-usdc'),
    ]
    const aero = derivePrices(edges, { [USDC]: 1 }).get(AERO)
    expect(aero?.via).toEqual(['weth-usdc', 'aero-weth'])
    expect(aero?.usd).toBeCloseTo(1.2, 9)
    expect(aero?.weight).toBeCloseTo(120_000, 6)
  })

  it('makes an edge with an empty or missing side no route', () => {
    const edges = [
      sided(WETH, USDC, 3000, 600_000, 0, 'empty-down'),
      { token0: WETH, token1: USDC, price: 3000, upToken1: 600_000, source: 'no-down' },
    ]
    expect(derivePrices(edges, { [USDC]: 1 }).has(WETH)).toBe(false)
  })

  it('keeps the fixed weight of an edge without sides', () => {
    const edges = [
      sided(WETH, USDC, 3000, 600_000, 50, 'weth-usdc'),
      edge(LONELY, WETH, 1, Number.MAX_SAFE_INTEGER, 'wrap'),
    ]
    const wrapped = derivePrices(edges, { [USDC]: 1 }).get(LONELY)
    expect(wrapped).toEqual({ usd: 3000, via: ['weth-usdc', 'wrap'], weight: 150_000 })
  })
})
