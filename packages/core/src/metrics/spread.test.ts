import { describe, expect, it } from 'vitest'
import { simulateSwapExactIn } from '../swap/index.js'
import { midPrice } from '../swap/midPrice.js'
import {
  buildConcentratedState,
  buildConstantProductState,
  buildStableSwapState,
  makeToken,
} from '../testing.js'
import { computeEffectiveSpread, SPREAD_MAX_LEG_IMPACT_BPS } from './spread.js'

const weth = makeToken('WETH', 18)
const usdc = makeToken('USDC', 6)

// WETH/USDC-like pool: token0 WETH (18), token1 USDC (6), price ≈ 3400, fee 5 bps
const wethUsdc = buildConcentratedState({
  positions: [{ tickLower: -210_000, tickUpper: -180_000, liquidity: 10n ** 20n }],
  tick: -195_000,
  feePips: 500,
  tickSpacing: 10,
})
const mid = midPrice(wethUsdc, 18, 6)

describe('computeEffectiveSpread', () => {
  it('buy > mid > sell, spread ≥ 2·fee for tiny notional, grows with size', () => {
    const points = computeEffectiveSpread(wethUsdc, weth, usdc, mid, 1, [1, 1_000, 100_000])
    expect(points.map((p) => p.notionalUsd)).toEqual([1, 1_000, 100_000])
    for (const p of points) {
      expect(p.feasible).toBe(true)
      if (p.spreadBps === null || p.buyAvgPrice === null || p.sellAvgPrice === null)
        throw new Error('expected a feasible point')
      expect(p.buyAvgPrice).toBeGreaterThan(mid)
      expect(p.sellAvgPrice).toBeLessThan(mid)
      expect(p.spreadBps).toBeGreaterThanOrEqual(2 * 5)
    }
    const [tiny, mid1k, big] = points
    if (!tiny?.spreadBps || !mid1k?.spreadBps || !big?.spreadBps) throw new Error('missing')
    expect(tiny.spreadBps).toBeLessThan(10.1)
    expect(mid1k.spreadBps).toBeLessThan(big.spreadBps)
  })

  it('uses the default notionals, $1K to $1M', () => {
    const points = computeEffectiveSpread(wethUsdc, weth, usdc, mid, 1)
    expect(points.map((p) => p.notionalUsd)).toEqual([1_000, 10_000, 100_000, 1_000_000])
  })

  it('makes the $1M point infeasible when its legs walk past the known ticks, never extrapolating', () => {
    // About $25K within 1 % on each side, ticks known for about ±10 % (as a snapshot reads them).
    const window = buildConcentratedState({
      positions: [{ tickLower: -199_080, tickUpper: -197_040, liquidity: 10n ** 17n }],
      tick: -198_080,
      feePips: 500,
      tickSpacing: 60,
    })
    const m = midPrice(window, 18, 6)
    const [oneK, tenK, hundredK, oneM] = computeEffectiveSpread(window, weth, usdc, m, 1)
    for (const p of [oneK, tenK, hundredK]) expect(p?.feasible).toBe(true)
    expect(hundredK?.spreadBps).toBeLessThan(10_000)
    expect(oneM).toEqual({
      notionalUsd: 1_000_000,
      spreadBps: null,
      feasible: false,
      buyAvgPrice: null,
      sellAvgPrice: null,
    })
    // The buy leg stops at the upper bound with most of the $1M unspent.
    const buy = simulateSwapExactIn(window, 'oneForZero', 1_000_000n * 10n ** 6n)
    expect(buy.complete).toBe(false)
    expect(buy.amountIn < 300_000n * 10n ** 6n).toBe(true)
  })

  it('is null when a USD price is missing', () => {
    for (const [p0, p1] of [
      [null, 1],
      [mid, null],
      [null, null],
    ] as const) {
      const points = computeEffectiveSpread(wethUsdc, weth, usdc, p0, p1, [1_000])
      expect(points[0]).toEqual({
        notionalUsd: 1_000,
        spreadBps: null,
        feasible: false,
        buyAvgPrice: null,
        sellAvgPrice: null,
      })
    }
  })

  it('is null when a leg cannot be filled', () => {
    const thin = buildConcentratedState({
      positions: [{ tickLower: -195_100, tickUpper: -194_900, liquidity: 10n ** 14n }],
      tick: -195_000,
      feePips: 500,
      tickSpacing: 10,
    })
    const points = computeEffectiveSpread(thin, weth, usdc, mid, 1, [10, 1_000_000])
    expect(points[0]?.feasible).toBe(true)
    expect(points[1]?.feasible).toBe(false)
    expect(points[1]?.spreadBps).toBeNull()
  })

  it('is null when the sell leg yields nothing (output rounds to 0 raw units)', () => {
    // token1 has 0 decimals: selling 1 token0 (18 dec) into 1000 raw token1 rounds to 0 out
    const t0 = makeToken('A', 18)
    const t1 = makeToken('B', 0)
    const cp = buildConstantProductState(1000n * 10n ** 18n, 1000n, 3000)
    expect(midPrice(cp, 18, 0)).toBe(1)
    const sell = simulateSwapExactIn(cp, 'zeroForOne', 10n ** 18n)
    expect(sell.complete).toBe(true)
    expect(sell.amountOut).toBe(0n)
    const buy = simulateSwapExactIn(cp, 'oneForZero', 1n)
    expect(buy.amountOut > 0n).toBe(true) // only the sell leg is empty
    const [pt] = computeEffectiveSpread(cp, t0, t1, 1000, 1000, [1000])
    expect(pt).toEqual({
      notionalUsd: 1000,
      spreadBps: null,
      feasible: false,
      buyAvgPrice: null,
      sellAvgPrice: null,
    })
    // a token1-starved 18/18 pool: $1000 of token0 in yields 0 token1
    const starved = buildConstantProductState(10n ** 24n, 10n ** 3n, 3000)
    const [starvedPt] = computeEffectiveSpread(starved, t0, makeToken('C', 18), 1, 1, [1000])
    expect(starvedPt?.feasible).toBe(false)
    expect(starvedPt?.spreadBps).toBeNull()
  })

  it('is null on a 100 % fee pool (Uniswap v4 MAX_LP_FEE) instead of throwing', () => {
    const maxFee = buildConcentratedState({
      positions: [{ tickLower: -210_000, tickUpper: -180_000, liquidity: 10n ** 20n }],
      tick: -195_000,
      feePips: 1_000_000,
      tickSpacing: 10,
    })
    const [pt] = computeEffectiveSpread(maxFee, weth, usdc, mid, 1, [1_000])
    expect(pt?.feasible).toBe(false)
    expect(pt?.spreadBps).toBeNull()
  })

  it('works for constant-product and stable pools', () => {
    const cp = buildConstantProductState(10n ** 21n, 3_400n * 10n ** 9n, 3000) // 1000 WETH / 3.4M USDC
    const cpMid = midPrice(cp, 18, 6)
    const [small, large] = computeEffectiveSpread(cp, weth, usdc, cpMid, 1, [100, 10_000])
    expect(small?.feasible).toBe(true)
    expect(small?.spreadBps ?? 0).toBeGreaterThanOrEqual(60) // 2 × 30 bps fee
    expect(small?.spreadBps ?? 0).toBeLessThan(61)
    // $10k against a $3.4M side costs ≈ 2 × 10k/3.4M ≈ 59 bps of impact on top of the fee
    expect(large?.spreadBps ?? 0).toBeGreaterThan(110)
    expect(large?.spreadBps ?? 0).toBeLessThan(125)

    const dai = makeToken('DAI', 18)
    const stable = buildStableSwapState(10n ** 12n, 10n ** 24n, 6, 18, 500)
    const [stPoint] = computeEffectiveSpread(stable, usdc, dai, 1, 1, [10_000])
    expect(stPoint?.feasible).toBe(true)
    expect(stPoint?.spreadBps ?? 0).toBeGreaterThanOrEqual(10)
    expect(stPoint?.spreadBps ?? 0).toBeLessThan(10.5)
  })
})

describe('price impact cap', () => {
  const impacts = (
    p: { buyAvgPrice: number | null; sellAvgPrice: number | null },
    midPrice_: number,
  ) => {
    if (p.buyAvgPrice === null || p.sellAvgPrice === null)
      throw new Error('expected a feasible point')
    return {
      buy: (p.buyAvgPrice / midPrice_ - 1) * 1e4,
      sell: (1 - p.sellAvgPrice / midPrice_) * 1e4,
    }
  }

  it('is 5,000 bps (50 %) per leg', () => {
    expect(SPREAD_MAX_LEG_IMPACT_BPS).toBe(5_000)
  })

  it('a trade larger than the pool is infeasible even though every leg completes', () => {
    // 1 WETH and 2,500 USDC (TVL $5,000): a $10,000 buy "completes" on a constant-product curve
    const small = buildConstantProductState(10n ** 18n, 2_500n * 10n ** 6n, 3000)
    const smallMid = midPrice(small, 18, 6)
    expect(simulateSwapExactIn(small, 'oneForZero', 10_000n * 10n ** 6n).complete).toBe(true)
    expect(simulateSwapExactIn(small, 'zeroForOne', 4n * 10n ** 18n).complete).toBe(true)
    const [pt] = computeEffectiveSpread(small, weth, usdc, 2_500, 1, [10_000])
    expect(pt).toEqual({
      notionalUsd: 10_000,
      spreadBps: null,
      feasible: false,
      buyAvgPrice: null,
      sellAvgPrice: null,
    })
    expect(smallMid).toBeCloseTo(2_500, 9)
  })

  it('stays feasible, with both legs reported, while each leg is within the cap', () => {
    // the same pool at $1,000: legs of 4,030 and 2,872 bps are under 5,000
    const small = buildConstantProductState(10n ** 18n, 2_500n * 10n ** 6n, 3000)
    const [pt] = computeEffectiveSpread(small, weth, usdc, 2_500, 1, [1_000])
    expect(pt?.feasible).toBe(true)
    const { buy, sell } = impacts(pt ?? { buyAvgPrice: null, sellAvgPrice: null }, 2_500)
    expect(buy).toBeCloseTo(4_030.09, 2)
    expect(sell).toBeCloseTo(2_872.46, 2)
    expect(pt?.spreadBps).toBeCloseTo(buy + sell, 6)
  })

  it('a dust pool publishes null, not 1e24 bps', () => {
    // 1,000 raw WETH-wei and 2,500 raw USDC: a few cents' worth of reserves
    const dust = buildConstantProductState(1_000n, 2_500n, 3000)
    const points = computeEffectiveSpread(dust, weth, usdc, 2_500, 1, [1_000, 10_000, 100_000])
    for (const p of points) {
      expect(p.feasible).toBe(false)
      expect(p.spreadBps).toBeNull()
    }
  })

  it('every feasible spread has both legs within the cap and is at most 10,000 bps', () => {
    const pools = [
      buildConstantProductState(10n ** 19n, 25_000n * 10n ** 6n, 3000),
      buildConstantProductState(10n ** 21n, 2_500_000n * 10n ** 6n, 500),
      buildStableSwapState(10n ** 11n, 10n ** 23n, 6, 18, 500),
      wethUsdc,
    ]
    const notionals = [10, 100, 1_000, 5_000, 10_000, 50_000, 100_000, 1_000_000]
    let feasible = 0
    let infeasible = 0
    for (const state of pools) {
      const isStable = state.kind === 'stable-swap'
      const [t0, t1] = isStable ? [usdc, makeToken('DAI', 18)] : [weth, usdc]
      const [p0, p1] = isStable ? [1, 1] : [2_500, 1]
      const m = isStable ? 1 : midPrice(state, 18, 6)
      for (const point of computeEffectiveSpread(state, t0, t1, p0, p1, notionals)) {
        if (!point.feasible) {
          infeasible++
          expect(point.spreadBps).toBeNull()
          continue
        }
        feasible++
        const { buy, sell } = impacts(point, m)
        expect(buy).toBeLessThanOrEqual(SPREAD_MAX_LEG_IMPACT_BPS)
        expect(sell).toBeLessThanOrEqual(SPREAD_MAX_LEG_IMPACT_BPS)
        expect(point.spreadBps ?? Number.NaN).toBeLessThanOrEqual(10_000)
      }
    }
    // the sweep covers both sides of the cap
    expect(feasible).toBeGreaterThan(10)
    expect(infeasible).toBeGreaterThan(3)
  })
})
