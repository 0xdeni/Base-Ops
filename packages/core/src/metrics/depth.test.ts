import { describe, expect, it } from 'vitest'
import { absBigint, rawToHuman } from '../math.js'
import { simulateSwapToPrice } from '../swap/index.js'
import { midPrice } from '../swap/midPrice.js'
import {
  buildConcentratedState,
  buildConstantProductState,
  buildStableSwapState,
  makeToken,
} from '../testing.js'
import { computeDepth, depthToUsd } from './depth.js'

const L = 10n ** 21n

describe('computeDepth', () => {
  it('up and down are symmetric for a symmetric constant-product pool', () => {
    const state = buildConstantProductState(10n ** 24n, 10n ** 24n, 3000)
    const levels = computeDepth(state, 18, 18)
    expect(levels.map((l) => l.pct)).toEqual([1, 2, 5])
    for (const level of levels) {
      expect(level.up.reached).toBe(true)
      expect(level.down.reached).toBe(true)
      // ±p % is not an exact mirror (1+p vs 1/(1−p)); they agree within p %
      const up = Number(level.up.amountIn)
      const down = Number(level.down.amountIn)
      expect(Math.abs(up / down - 1)).toBeLessThan(level.pct / 100)
      // the exact mirror: up to ×(1+p) equals down to ×1/(1+p)
      const mirror = simulateSwapToPrice(state, 1 / (1 + level.pct / 100), {
        decimals0: 18,
        decimals1: 18,
      })
      // 1/(1+p) is not exactly representable: equal to double precision
      const diff = absBigint(mirror.amountIn - level.up.amountIn)
      expect(diff * 10n ** 12n <= level.up.amountIn).toBe(true)
    }
    // closed form for +5 %: net = y·(√1.05 − 1)
    const five = levels[2]
    if (!five) throw new Error('missing level')
    const net = five.up.amountIn - (five.up.amountIn * 3000n) / 1_000_000n
    expect(Number(net) / 1e24).toBeCloseTo(Math.sqrt(1.05) - 1, 9)
  })

  it('up and down are symmetric for a symmetric concentrated pool', () => {
    const state = buildConcentratedState({
      positions: [{ tickLower: -6000, tickUpper: 6000, liquidity: L }],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const levels = computeDepth(state, 18, 18)
    for (const level of levels) {
      expect(level.up.reached).toBe(true)
      expect(level.down.reached).toBe(true)
      const up = Number(level.up.amountIn)
      const down = Number(level.down.amountIn)
      expect(Math.abs(up / down - 1)).toBeLessThan(level.pct / 100)
      expect(level.up.amountOut > 0n).toBe(true)
      expect(level.down.amountOut > 0n).toBe(true)
    }
    // deeper moves need more input
    const [one, two, five] = levels
    if (!one || !two || !five) throw new Error('missing level')
    expect(two.up.amountIn > one.up.amountIn).toBe(true)
    expect(five.up.amountIn > two.up.amountIn).toBe(true)
  })

  it('marks unreached levels when liquidity runs out', () => {
    const narrow = buildConcentratedState({
      positions: [{ tickLower: -120, tickUpper: 120, liquidity: L }],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const levels = computeDepth(narrow, 18, 18)
    const [one, two, five] = levels
    if (!one || !two || !five) throw new Error('missing level')
    expect(one.up.reached).toBe(true) // 1 % ≈ 100 ticks, inside ±120
    expect(two.up.reached).toBe(false)
    expect(two.down.reached).toBe(false)
    expect(five.up.reached).toBe(false)
    // totals to exhaustion are reported and are the same for 2 % and 5 %
    expect(two.up.amountIn).toBe(five.up.amountIn)
    expect(two.up.amountIn > one.up.amountIn).toBe(true)
  })

  it('uses the stable pool marginal price', () => {
    const state = buildStableSwapState(10n ** 12n, 10n ** 24n, 6, 18, 500)
    const levels = computeDepth(state, 6, 18, [1])
    const level = levels[0]
    if (!level) throw new Error('missing level')
    expect(level.up.reached).toBe(true)
    expect(level.down.reached).toBe(true)
    // input tokens differ: up is token1 (18 dec), down is token0 (6 dec); human amounts similar
    expect(rawToHuman(level.up.amountIn, 18) / rawToHuman(level.down.amountIn, 6)).toBeCloseTo(1, 1)
  })

  it('an empty pool gives zero, unreached sides', () => {
    const levels = computeDepth(buildConstantProductState(0n, 0n, 3000), 18, 18)
    for (const level of levels) {
      expect(level.up).toEqual({ amountIn: 0n, amountOut: 0n, reached: false })
      expect(level.down).toEqual({ amountIn: 0n, amountOut: 0n, reached: false })
    }
    expect(computeDepth(buildConstantProductState(1n, 1n, 3000), 18, 18, [0, 100])).toHaveLength(2)
  })

  it('custom levels are honoured', () => {
    const state = buildConstantProductState(10n ** 24n, 10n ** 24n, 3000)
    expect(computeDepth(state, 18, 18, [0.5, 10]).map((l) => l.pct)).toEqual([0.5, 10])
    expect(midPrice(state, 18, 18)).toBe(1)
  })
})

describe('depthToUsd', () => {
  const usdc = makeToken('USDC', 6)
  const weth = makeToken('WETH', 18)

  it('converts with each token decimals and USD price', () => {
    const levels = [
      {
        pct: 2,
        up: { amountIn: 10n ** 18n, amountOut: 1n, reached: true }, // 1 WETH in (token1)
        down: { amountIn: 2_500_000_000n, amountOut: 1n, reached: true }, // 2 500 USDC in (token0)
      },
    ]
    const [usd] = depthToUsd(levels, usdc, weth, 1, 3000)
    expect(usd).toEqual({ pct: 2, upUsd: 3000, downUsd: 2500, totalUsd: 5500 })
  })

  it('null prices give null sides and partial totals', () => {
    const levels = [
      {
        pct: 1,
        up: { amountIn: 10n ** 18n, amountOut: 0n, reached: false },
        down: { amountIn: 1_000_000n, amountOut: 0n, reached: true },
      },
    ]
    expect(depthToUsd(levels, usdc, weth, 1, null)[0]).toEqual({
      pct: 1,
      upUsd: null,
      downUsd: 1,
      totalUsd: 1,
    })
    expect(depthToUsd(levels, usdc, weth, null, 3000)[0]).toEqual({
      pct: 1,
      upUsd: 3000,
      downUsd: null,
      totalUsd: 3000,
    })
    expect(depthToUsd(levels, usdc, weth, null, null)[0]).toEqual({
      pct: 1,
      upUsd: null,
      downUsd: null,
      totalUsd: null,
    })
  })
})
