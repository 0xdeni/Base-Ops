/**
 * The worked examples in docs/METRICS.md, reproduced to the digit.
 *
 * That page is the single definition of every number Depthwatch publishes and names this file as
 * its regression anchor: raw amounts are asserted to the wei, USD and bps figures to the cent /
 * two decimals exactly as the page prints them. A change that moves any figure here must update
 * the page in the same commit.
 */

import { describe, expect, it } from 'vitest'
import { rawToHuman } from '../math.js'
import { simulateSwapExactIn } from '../swap/index.js'
import { midPrice } from '../swap/midPrice.js'
import { buildConcentratedState, buildConstantProductState, makeToken } from '../testing.js'
import { getSqrtRatioAtTick, priceToSqrtPriceX96, sqrtPriceX96ToPrice } from '../tickMath.js'
import type { Address, Position } from '../types.js'
import {
  bandSqrtBounds,
  computeConcentration,
  computeConcentrationForReserves,
} from './concentration.js'
import { computeDepth, depthToUsd } from './depth.js'
import { computeGap } from './gap.js'
import { computePersistence } from './persistence.js'
import { computeEffectiveSpread } from './spread.js'
import { tvlUsd } from './tvl.js'
import { computeVolume24hUsd, scoringVolumeWindow, volumeWindow } from './volume.js'

/** Rounds to the two decimals METRICS.md prints, so `toBe` compares the printed digits. */
function twoDp(x: number | null): number | null {
  return x === null ? null : Number(x.toFixed(2))
}

const weth = makeToken('WETH', 18)
const usdc = makeToken('USDC', 6)
const WETH_USD = 2_500
const USDC_USD = 1

/** "A constant-product WETH/USDC pool with 1,000 WETH and 2,500,000 USDC, fee 0.30 % (3000 pips)". */
const pool = buildConstantProductState(1_000n * 10n ** 18n, 2_500_000n * 10n ** 6n, 3000)

const now = 1_700_000_000
const hour = 3600
/** "Six samples 4 h apart in the last 24 h with depth2Usd of 100,000; 120,000; 95,000; 110,000; 40,000; 105,000." */
const sixSamples = [100_000, 120_000, 95_000, 110_000, 40_000, 105_000].map((depthUsd, i) => ({
  timestamp: now - i * 4 * hour,
  depthUsd,
}))
const persistence24h = computePersistence(sixSamples, 24, now)
const twoSamplePersistence = computePersistence(sixSamples.slice(0, 2), 24, now)

describe('docs/METRICS.md worked examples', () => {
  it('Conventions: 2,500 USDC per WETH is sqrtPriceX96 3961408125713216879677197', () => {
    expect(priceToSqrtPriceX96(2_500, 18, 6)).toBe(3961408125713216879677197n)
    expect(sqrtPriceX96ToPrice(3961408125713216879677197n, 18, 6)).toBeCloseTo(2_500, 9)
    expect(midPrice(pool, 18, 6)).toBe(2_500)
  })

  it('Depth at ±p %: raw amounts to the wei, USD to the cent', () => {
    const levels = computeDepth(pool, 18, 6)
    expect(levels.map((l) => l.pct)).toEqual([1, 2, 5])
    const [one, two, five] = levels
    if (!one || !two || !five) throw new Error('missing level')

    // Up 2 %: net 24,876.23 USDC, grossed up for the fee to 24,951.09 USDC; ≈ 9.8525 WETH out.
    expect(two.up.reached).toBe(true)
    expect(two.up.amountIn).toBe(24951087854n)
    expect(twoDp(rawToHuman(two.up.amountIn, 6) * 0.997)).toBe(24_876.23)
    expect(rawToHuman(two.up.amountOut, 18)).toBeCloseTo(9.8525, 4)
    // Down 2 %: net 10.1525 WETH, grossed up to 10.1831 WETH.
    expect(two.down.reached).toBe(true)
    expect(two.down.amountIn).toBe(10183093833711884799n)
    expect(rawToHuman(two.down.amountIn, 18) * 0.997).toBeCloseTo(10.1525, 4)
    expect(rawToHuman(two.down.amountIn, 18)).toBeCloseTo(10.1831, 4)

    const [oneUsd, twoUsd, fiveUsd] = depthToUsd(levels, weth, usdc, WETH_USD, USDC_USD)
    if (!oneUsd || !twoUsd || !fiveUsd) throw new Error('missing level')
    expect(twoDp(twoUsd.upUsd)).toBe(24_951.09)
    expect(twoDp(twoUsd.downUsd)).toBe(25_457.73)
    expect(twoDp(twoUsd.totalUsd)).toBe(50_408.82)
    expect(twoDp(oneUsd.totalUsd)).toBe(25_138.86)
    expect(twoDp(fiveUsd.totalUsd)).toBe(127_064.77)
  })

  it('Effective spread at $1,000 / $10,000 / $100,000', () => {
    const points = computeEffectiveSpread(pool, weth, usdc, WETH_USD, USDC_USD)
    expect(points.map((p) => p.notionalUsd)).toEqual([1_000, 10_000, 100_000])
    const [oneK, tenK, hundredK] = points
    if (!oneK || !tenK || !hundredK) throw new Error('missing point')
    for (const p of points) expect(p.feasible).toBe(true)

    // N = $10,000: buyAvg 2,517.52 from 3.97216 WETH out; sellAvg 2,482.60 from 9,930.40 USDC out.
    expect(twoDp(tenK.buyAvgPrice)).toBe(2_517.52)
    expect(twoDp(tenK.sellAvgPrice)).toBe(2_482.6)
    if (tenK.buyAvgPrice === null || tenK.sellAvgPrice === null) throw new Error('missing leg')
    expect(10_000 / tenK.buyAvgPrice).toBeCloseTo(3.97216, 5)
    expect(twoDp(tenK.sellAvgPrice * 4)).toBe(9_930.4)
    expect(twoDp(tenK.spreadBps)).toBe(139.69)

    expect(twoDp(oneK.spreadBps)).toBe(68.06)
    expect(twoDp(hundredK.spreadBps)).toBe(842.45)
  })

  it('Effective spread: the price impact cap on a $5,000 and a $50,000 pool', () => {
    // 1 WETH and 2,500 USDC (TVL $5,000), N = $10,000: buy impact 40,030.09 bps, sell 8,001.20.
    const tiny = buildConstantProductState(10n ** 18n, 2_500n * 10n ** 6n, 3000)
    const buy = simulateSwapExactIn(tiny, 'oneForZero', 10_000n * 10n ** 6n)
    const sell = simulateSwapExactIn(tiny, 'zeroForOne', 4n * 10n ** 18n)
    expect(buy.complete && sell.complete).toBe(true)
    expect(rawToHuman(buy.amountOut, 18)).toBeCloseTo(0.79952, 5)
    expect(twoDp(10_000 / rawToHuman(buy.amountOut, 18))).toBe(12_507.52)
    expect(twoDp(rawToHuman(sell.amountOut, 6))).toBe(1_998.8)
    expect(twoDp(rawToHuman(sell.amountOut, 6) / 4)).toBe(499.7)
    const [infeasible] = computeEffectiveSpread(tiny, weth, usdc, WETH_USD, USDC_USD, [10_000])
    expect(infeasible?.feasible).toBe(false)
    expect(infeasible?.spreadBps).toBeNull()
    // The same trade without the cap would have published 48,031.29 bps.
    const uncapped = ((12_507.522567703109 - 499.69927825) / 2_500) * 1e4
    expect(twoDp(uncapped)).toBe(48_031.29)

    // 10 WETH and 25,000 USDC (TVL $50,000): legs of 4,030.09 and 2,872.46 bps, spread 6,902.55.
    const larger = buildConstantProductState(10n * 10n ** 18n, 25_000n * 10n ** 6n, 3000)
    const [feasible] = computeEffectiveSpread(larger, weth, usdc, WETH_USD, USDC_USD, [10_000])
    expect(feasible?.feasible).toBe(true)
    if (!feasible?.buyAvgPrice || !feasible.sellAvgPrice) throw new Error('missing leg')
    expect(twoDp(feasible.buyAvgPrice)).toBe(3_507.52)
    expect(twoDp(feasible.sellAvgPrice)).toBe(1_781.88)
    expect(twoDp((feasible.buyAvgPrice / 2_500 - 1) * 1e4)).toBe(4_030.09)
    expect(twoDp((1 - feasible.sellAvgPrice / 2_500) * 1e4)).toBe(2_872.46)
    expect(twoDp(feasible.spreadBps)).toBe(6_902.55)

    // The legs of the main example's $10,000 spread: 70.09 and 69.60 bps, summing to 139.69.
    const [main] = computeEffectiveSpread(pool, weth, usdc, WETH_USD, USDC_USD, [10_000])
    if (!main?.buyAvgPrice || !main.sellAvgPrice) throw new Error('missing leg')
    expect(twoDp((main.buyAvgPrice / 2_500 - 1) * 1e4)).toBe(70.09)
    expect(twoDp((1 - main.sellAvgPrice / 2_500) * 1e4)).toBe(69.6)
  })

  it('LP concentration: ranges 60/30/10 and owners 42/38/20', () => {
    // Three in-band ranges around tick 0 (±5 % ≈ ±488 ticks): [band.lower, −200], [−200, 200],
    // [200, band.upper]. Liquidity is chosen so that L × Δ√P weighs 30, 60 and 10 units, with the
    // current tick inside the 60 range.
    const band = bandSqrtBounds(getSqrtRatioAtTick(0), 5)
    const widths = [
      getSqrtRatioAtTick(-200) - band.lower,
      getSqrtRatioAtTick(200) - getSqrtRatioAtTick(-200),
      band.upper - getSqrtRatioAtTick(200),
    ]
    const liquidity = [30n, 60n, 10n].map((units, i) => (units * 10n ** 48n) / (widths[i] ?? 1n))
    const ranged = buildConcentratedState({
      positions: [
        { tickLower: -1_000, tickUpper: -200, liquidity: liquidity[0] ?? 0n },
        { tickLower: -200, tickUpper: 200, liquidity: liquidity[1] ?? 0n },
        { tickLower: 200, tickUpper: 1_000, liquidity: liquidity[2] ?? 0n },
      ],
      tick: 0,
      feePips: 3000,
      tickSpacing: 10,
    })
    const structural = computeConcentration(ranged, null)
    expect(structural.rangeHhi).toBeCloseTo(0.46, 12)
    expect(structural.activeRangeShare).toBeCloseTo(0.6, 12)
    expect(structural.owners).toBeNull()

    // Three owners with weights 42, 38, 20 (identical ranges, so weight ∝ liquidity).
    const owner = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
    const positions: Position[] = [42n, 38n, 20n].map((liquidity, i) => ({
      owner: owner(i + 1),
      tickLower: -6_000,
      tickUpper: 6_000,
      liquidity,
      tokenId: BigInt(i + 1),
    }))
    const state = buildConcentratedState({
      positions: positions.map(({ tickLower, tickUpper, liquidity }) => ({
        tickLower,
        tickUpper,
        liquidity,
      })),
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const owners = computeConcentration(state, positions).owners
    if (!owners) throw new Error('positions were indexed')
    expect(owners.count).toBe(3)
    expect(owners.top1Share).toBe(0.42)
    expect(owners.top3Share).toBe(1)
    expect(owners.hhi).toBeCloseTo(0.3608, 12)
    expect(owners.coverage).toBe(1)
    // The owner of the 20 is the pool's gauge: 42 and 38 remain, covering 80 of 100.
    const gauged = computeConcentration(state, positions, 5, [owner(3)]).owners
    expect(gauged?.top1Share).toBe(0.525)
    expect(gauged?.count).toBe(2)
    expect(gauged?.coverage).toBe(0.8)
    // Only positions weighing 40 of the 100 indexed.
    const partial = computeConcentration(state, [{ ...positions[2], liquidity: 40n } as Position])
    expect(partial.owners?.coverage).toBe(0.4)

    // Reserve pools are one full-range position.
    expect(computeConcentrationForReserves(pool)).toEqual({
      bandPct: 5,
      rangeHhi: 1,
      activeRangeShare: 1,
      owners: null,
    })
  })

  it('Liquidity persistence over 24 h', () => {
    expect(persistence24h.windowHours).toBe(24)
    expect(persistence24h.samples).toBe(6)
    expect(persistence24h.depthUsdMedian).toBe(102_500)
    expect(persistence24h.depthUsdP10).toBe(67_500)
    expect(persistence24h.depthUsdMin).toBe(40_000)
    expect(persistence24h.stability).toBe(67_500 / 102_500)
    expect(persistence24h.stability).toBeCloseTo(0.6585, 4)
    expect(persistence24h.uptime).toBe(5 / 6)
    expect(persistence24h.uptime).toBeCloseTo(0.8333, 4)

    // "With only the first two samples, median = 110,000, p10 = 102,000, both null."
    expect(twoSamplePersistence.samples).toBe(2)
    expect(twoSamplePersistence.depthUsdMedian).toBe(110_000)
    expect(twoSamplePersistence.depthUsdP10).toBe(102_000)
    expect(twoSamplePersistence.stability).toBeNull()
    expect(twoSamplePersistence.uptime).toBeNull()

    // "Three samples 1 h apart are null too (2 h < 6 h); 3 samples spanning 6 h exactly count."
    const threeAt = (spacingHours: number, depthUsd: number) =>
      [0, 1, 2].map((i) => ({ timestamp: now - i * spacingHours * hour, depthUsd }))
    expect(computePersistence(threeAt(1, 100_000), 24, now).stability).toBeNull()
    expect(computePersistence(threeAt(3, 100_000), 24, now).stability).toBe(1)
    // "Three samples of 0, whether 1 h or 11 h apart, give stability = 0 and uptime = 0."
    for (const spacing of [1, 11]) {
      const dead = computePersistence(threeAt(spacing, 0), 24, now)
      expect(dead.stability).toBe(0)
      expect(dead.uptime).toBe(0)
    }
  })

  it('24 h volume: the 24 whole hours before the hour of the last volume read', () => {
    const today = Date.UTC(2026, 9, 25) / 1000
    const end = today + 14 * 3_600 + 37 * 60 + 20 // last block read at 14:37:20 UTC
    const window = volumeWindow(end)
    expect(window).toEqual({ fromTs: today + 14 * 3_600 - 86_400, toTs: today + 14 * 3_600 })
    const hour = (hourStart: number, volumeUsd: number) => ({ hourStart, volumeUsd, swapCount: 1 })
    const buckets = [
      ...Array.from({ length: 24 }, (_, i) => hour(window.fromTs + i * 3_600, 20_000)),
      hour(window.toTs, 9_000), // 14:00-14:37 today, still filling
      hour(window.fromTs - 3_600, 20_000), // 13:00 yesterday
    ]
    expect(computeVolume24hUsd(window, window.fromTs, buckets)).toBe(480_000)
    expect(scoringVolumeWindow(end, today + 15 * 3_600 + 10 * 60)).toEqual(window)
    expect(computeVolume24hUsd(window, window.fromTs + 3_600, buckets)).toBeNull()
  })

  it('Gap score', () => {
    const gap = computeGap(500_000, 20_000)
    expect(gap.turnoverRatio).toBe(25)
    expect(twoDp(gap.gapScore)).toBe(69.9)
    expect(computeGap(20_000, 20_000).gapScore).toBe(0)
    expect(computeGap(2_000_000, 20_000).gapScore).toBe(100)
    expect(computeGap(5_000, 20_000).gapScore).toBe(0)
    expect(computeGap(500_000, 0).gapScore).toBeNull()
  })

  it('TVL of the worked-example pool is $5,000,000', () => {
    expect(tvlUsd(pool.reserve0, pool.reserve1, weth, usdc, WETH_USD, USDC_USD)).toBe(5_000_000)
  })
})
