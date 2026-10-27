import { describe, expect, it } from 'vitest'
import { Q96 } from './math.js'
import {
  clampTick,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  priceToSqrtPriceX96,
  sqrtPriceX96ToPrice,
} from './tickMath.js'

describe('getSqrtRatioAtTick', () => {
  it('matches the Uniswap v3 constants', () => {
    expect(getSqrtRatioAtTick(0)).toBe(79228162514264337593543950336n)
    expect(getSqrtRatioAtTick(0)).toBe(Q96)
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(4295128739n)
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(MIN_SQRT_RATIO)
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n)
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(MAX_SQRT_RATIO)
    expect(getSqrtRatioAtTick(1)).toBe(79232123823359799118286999568n)
    expect(getSqrtRatioAtTick(-1)).toBe(79224201403219477170569942574n)
  })

  it('every magic constant is sqrt(1.0001)^(2^i) within float precision', () => {
    for (let bit = 0; bit < 20; bit++) {
      const tick = 2 ** bit
      if (tick > MAX_TICK) break
      const expected = 2 ** 96 * 1.0001 ** (tick / 2)
      const got = Number(getSqrtRatioAtTick(tick))
      expect(Math.abs(got / expected - 1)).toBeLessThan(1e-9)
      const gotNeg = Number(getSqrtRatioAtTick(-tick))
      expect(Math.abs(gotNeg / (2 ** 96 / 1.0001 ** (tick / 2)) - 1)).toBeLessThan(1e-9)
    }
  })

  it('is monotonic and rejects out-of-range ticks', () => {
    expect(getSqrtRatioAtTick(100) > getSqrtRatioAtTick(99)).toBe(true)
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow(RangeError)
    expect(() => getSqrtRatioAtTick(MIN_TICK - 1)).toThrow(RangeError)
    expect(() => getSqrtRatioAtTick(1.5)).toThrow(RangeError)
  })
})

describe('getTickAtSqrtRatio', () => {
  it('is the exact inverse over thousands of ticks', () => {
    const ticks: number[] = [MIN_TICK, MAX_TICK - 1, -1, 0, 1, 60, -60, 887271, -887271]
    for (let t = MIN_TICK; t < MAX_TICK; t += 397) ticks.push(t)
    for (let t = -300_000; t <= 300_000; t += 60) ticks.push(t)
    for (const t of ticks) {
      const ratio = getSqrtRatioAtTick(t)
      expect(getTickAtSqrtRatio(ratio)).toBe(t)
      if (t > MIN_TICK) expect(getTickAtSqrtRatio(ratio - 1n)).toBe(t - 1)
      if (t < MAX_TICK - 1) expect(getTickAtSqrtRatio(ratio + 1n)).toBe(t)
    }
  })

  it('handles the extremes like the contract', () => {
    expect(getTickAtSqrtRatio(MIN_SQRT_RATIO)).toBe(MIN_TICK)
    expect(getTickAtSqrtRatio(MAX_SQRT_RATIO - 1n)).toBe(MAX_TICK - 1)
    expect(() => getTickAtSqrtRatio(MAX_SQRT_RATIO)).toThrow(RangeError)
    expect(() => getTickAtSqrtRatio(MIN_SQRT_RATIO - 1n)).toThrow(RangeError)
  })

  it('clampTick', () => {
    expect(clampTick(1e9)).toBe(MAX_TICK)
    expect(clampTick(-1e9)).toBe(MIN_TICK)
    expect(clampTick(5)).toBe(5)
  })
})

describe('price conversions', () => {
  it('sqrtPriceX96ToPrice adjusts for decimals', () => {
    expect(sqrtPriceX96ToPrice(Q96, 18, 18)).toBe(1)
    expect(sqrtPriceX96ToPrice(2n * Q96, 18, 18)).toBe(4)
    // raw price 1e-12 token1/token0 between an 18-dec token0 and 6-dec token1 is a human price of 1
    const sqrt = priceToSqrtPriceX96(1, 18, 6)
    expect(sqrtPriceX96ToPrice(sqrt, 18, 6)).toBeCloseTo(1, 12)
  })

  it('priceToSqrtPriceX96 is exact for exact inputs and inverts the conversion', () => {
    expect(priceToSqrtPriceX96(1, 18, 18)).toBe(Q96)
    expect(priceToSqrtPriceX96(4, 18, 18)).toBe(2n * Q96)
    // 1e-12 is not an exact double, so the two are equal only to double precision
    const viaRaw = priceToSqrtPriceX96(1e-12, 18, 18)
    const viaDecimals = priceToSqrtPriceX96(1, 18, 6)
    expect(Number(viaRaw) / Number(viaDecimals)).toBeCloseTo(1, 12)
    for (const price of [0.0001, 0.37, 1, 3401.58, 65000, 1e9]) {
      for (const [d0, d1] of [
        [18, 18],
        [6, 18],
        [18, 6],
        [8, 18],
      ] as const) {
        const sqrt = priceToSqrtPriceX96(price, d0, d1)
        expect(sqrtPriceX96ToPrice(sqrt, d0, d1) / price).toBeCloseTo(1, 12)
      }
    }
    const tick = 123_456
    const back = priceToSqrtPriceX96(sqrtPriceX96ToPrice(getSqrtRatioAtTick(tick), 18, 18), 18, 18)
    // ratio(tick) is the lower edge of the tick, so a double round trip may land one unit below
    expect(Math.abs(getTickAtSqrtRatio(back) - tick)).toBeLessThanOrEqual(1)
    expect(() => priceToSqrtPriceX96(0, 18, 18)).toThrow(RangeError)
    expect(() => priceToSqrtPriceX96(Number.NaN, 18, 18)).toThrow(RangeError)
  })
})
