import { describe, expect, it } from 'vitest'
import {
  clamp,
  divRoundingUp,
  humanToRaw,
  median,
  mulDiv,
  mulDivRoundingUp,
  numberToFraction,
  percentile,
  rawToHuman,
  sqrtBigint,
} from './math.js'

describe('bigint helpers', () => {
  it('mulDiv floors and mulDivRoundingUp ceils', () => {
    expect(mulDiv(7n, 3n, 2n)).toBe(10n)
    expect(mulDivRoundingUp(7n, 3n, 2n)).toBe(11n)
    expect(mulDivRoundingUp(6n, 3n, 2n)).toBe(9n)
    expect(divRoundingUp(10n, 3n)).toBe(4n)
    expect(divRoundingUp(9n, 3n)).toBe(3n)
    expect(() => mulDiv(1n, 1n, 0n)).toThrow(RangeError)
  })

  it('sqrtBigint is the exact floor square root', () => {
    expect(sqrtBigint(0n)).toBe(0n)
    expect(sqrtBigint(1n)).toBe(1n)
    expect(sqrtBigint(15n)).toBe(3n)
    expect(sqrtBigint(16n)).toBe(4n)
    expect(sqrtBigint(17n)).toBe(4n)
    const big = (1n << 200n) + 12345n
    const root = sqrtBigint(big)
    expect(root * root <= big).toBe(true)
    expect((root + 1n) * (root + 1n) > big).toBe(true)
    expect(sqrtBigint((1n << 192n) * 4n)).toBe(1n << 97n)
    expect(() => sqrtBigint(-1n)).toThrow(RangeError)
  })
})

describe('number helpers', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(Number.NaN, 0, 1)).toBeNaN()
  })

  it('percentile interpolates between order statistics', () => {
    const values = [5, 1, 4, 2, 3]
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 100)).toBe(5)
    expect(percentile(values, 50)).toBe(3)
    expect(percentile(values, 10)).toBeCloseTo(1.4, 12)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNaN()
    expect(() => percentile(values, 101)).toThrow(RangeError)
  })
})

describe('fractions and unit conversion', () => {
  it('numberToFraction is exact', () => {
    expect(numberToFraction(0.5)).toEqual({ num: 1n, den: 2n })
    expect(numberToFraction(3)).toEqual({ num: 3n, den: 1n })
    expect(numberToFraction(-0.75)).toEqual({ num: -3n, den: 4n })
    expect(numberToFraction(0)).toEqual({ num: 0n, den: 1n })
    const { num, den } = numberToFraction(0.1)
    expect(Number(num) / Number(den)).toBe(0.1)
    expect(() => numberToFraction(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('humanToRaw / rawToHuman round-trip', () => {
    expect(humanToRaw(1.5, 6)).toBe(1_500_000n)
    expect(humanToRaw(0.000001, 6)).toBe(1n)
    expect(humanToRaw(1, 18)).toBe(10n ** 18n)
    expect(rawToHuman(1_500_000n, 6)).toBe(1.5)
    expect(rawToHuman(10n ** 18n, 18)).toBe(1)
    expect(rawToHuman(humanToRaw(1234.5678, 18), 18)).toBeCloseTo(1234.5678, 10)
  })
})
