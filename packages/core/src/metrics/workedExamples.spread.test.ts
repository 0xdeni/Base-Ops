/**
 * The effective spread's worked examples in docs/METRICS.md, reproduced to the two decimals the
 * page prints (the other metrics' are in workedExamples.test.ts). A change that moves any figure
 * here must update the page in the same commit.
 */

import { describe, expect, it } from 'vitest'
import { rawToHuman } from '../math.js'
import { simulateSwapExactIn } from '../swap/index.js'
import { buildConstantProductState, makeToken } from '../testing.js'
import { computeEffectiveSpread } from './spread.js'

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

/** Per-leg price impact in bps against the $2,500 mid. */
const buyImpact = (buyAvg: number) => (buyAvg / 2_500 - 1) * 1e4
const sellImpact = (sellAvg: number) => (1 - sellAvg / 2_500) * 1e4

describe('docs/METRICS.md worked examples: effective spread', () => {
  it('Effective spread at $1,000 / $10,000 / $100,000 / $1,000,000', () => {
    const points = computeEffectiveSpread(pool, weth, usdc, WETH_USD, USDC_USD)
    expect(points.map((p) => p.notionalUsd)).toEqual([1_000, 10_000, 100_000, 1_000_000])
    const [oneK, tenK, hundredK, oneM] = points
    if (!oneK || !tenK || !hundredK || !oneM) throw new Error('missing point')
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
    expect(twoDp(oneM.spreadBps)).toBe(6_902.55)
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

  it('Effective spread: $1,000,000 on the first pool and on a $1,000,000 pool at 0.05 %', () => {
    // The first pool: 1,000,000 USDC buys 285.10 WETH, 400 WETH sell for 712,753.79 USDC.
    const buy = simulateSwapExactIn(pool, 'oneForZero', 1_000_000n * 10n ** 6n)
    const sell = simulateSwapExactIn(pool, 'zeroForOne', 400n * 10n ** 18n)
    expect(twoDp(rawToHuman(buy.amountOut, 18))).toBe(285.1)
    expect(twoDp(rawToHuman(sell.amountOut, 6))).toBe(712_753.79)
    const [oneM] = computeEffectiveSpread(pool, weth, usdc, WETH_USD, USDC_USD, [1_000_000])
    if (!oneM?.buyAvgPrice || !oneM.sellAvgPrice) throw new Error('missing leg')
    expect(twoDp(oneM.buyAvgPrice)).toBe(3_507.52)
    expect(twoDp(oneM.sellAvgPrice)).toBe(1_781.88)
    expect(twoDp(buyImpact(oneM.buyAvgPrice))).toBe(4_030.09)
    expect(twoDp(sellImpact(oneM.sellAvgPrice))).toBe(2_872.46)
    expect(twoDp(oneM.spreadBps)).toBe(6_902.55)

    // 200 WETH and 500,000 USDC at 0.05 %: cheaper at $1,000, can't absorb $1,000,000.
    const lowFee = buildConstantProductState(200n * 10n ** 18n, 500_000n * 10n ** 6n, 500)
    const ladder = computeEffectiveSpread(lowFee, weth, usdc, WETH_USD, USDC_USD)
    expect(ladder.map((p) => twoDp(p.spreadBps))).toEqual([49.94, 405.89, 3_675.14, null])
    expect(ladder.map((p) => p.feasible)).toEqual([true, true, true, false])
    const lowBuy = simulateSwapExactIn(lowFee, 'oneForZero', 1_000_000n * 10n ** 6n)
    const lowSell = simulateSwapExactIn(lowFee, 'zeroForOne', 400n * 10n ** 18n)
    expect(lowBuy.complete && lowSell.complete).toBe(true)
    const boughtWeth = rawToHuman(lowBuy.amountOut, 18)
    const soldFor = rawToHuman(lowSell.amountOut, 6)
    expect(twoDp(boughtWeth)).toBe(133.31)
    expect(twoDp(1_000_000 / boughtWeth)).toBe(7_501.25)
    expect(twoDp(buyImpact(1_000_000 / boughtWeth))).toBe(20_005)
    expect(twoDp(soldFor)).toBe(333_277.76)
    expect(twoDp(soldFor / 400)).toBe(833.19)
    expect(twoDp(sellImpact(soldFor / 400))).toBe(6_667.22)
  })
})
