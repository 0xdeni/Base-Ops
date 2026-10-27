import { describe, expect, it } from 'vitest'
import { divRoundingUp, Q96 } from './math.js'
import {
  computeSwapStep,
  getAmount0Delta,
  getAmount1Delta,
  getNextSqrtPriceFromAmount0RoundingUp,
  getNextSqrtPriceFromAmount1RoundingDown,
  getNextSqrtPriceFromInput,
  getNextSqrtPriceFromOutput,
} from './sqrtPriceMath.js'

describe('amount deltas', () => {
  it('match hand-computed values on a price move from 1 to 4', () => {
    // L = 1000, √P from 2^96 to 2·2^96: Δ1 = L·(√Pb − √Pa)/2^96 = 1000, Δ0 = L·2^96·(√Pb−√Pa)/(√Pa·√Pb) = 500
    expect(getAmount1Delta(Q96, 2n * Q96, 1000n, true)).toBe(1000n)
    expect(getAmount1Delta(Q96, 2n * Q96, 1000n, false)).toBe(1000n)
    expect(getAmount0Delta(Q96, 2n * Q96, 1000n, true)).toBe(500n)
    expect(getAmount0Delta(Q96, 2n * Q96, 1000n, false)).toBe(500n)
    // argument order does not matter
    expect(getAmount0Delta(2n * Q96, Q96, 1000n, false)).toBe(500n)
    expect(getAmount1Delta(2n * Q96, Q96, 1000n, false)).toBe(1000n)
  })

  it('rounds up for inputs and down for outputs', () => {
    expect(getAmount1Delta(Q96, Q96 + 1n, 3n, false)).toBe(0n)
    expect(getAmount1Delta(Q96, Q96 + 1n, 3n, true)).toBe(1n)
    expect(getAmount0Delta(Q96, Q96 + 1n, 3n, false)).toBe(0n)
    expect(getAmount0Delta(Q96, Q96 + 1n, 3n, true)).toBe(1n)
    expect(getAmount0Delta(Q96, Q96, 3n, true)).toBe(0n)
    expect(() => getAmount0Delta(0n, Q96, 1n, true)).toThrow(RangeError)
  })
})

describe('next sqrt price', () => {
  it('from token1 input: √P + Δ1·2^96/L', () => {
    expect(getNextSqrtPriceFromInput(Q96, 1000n, 1000n, false)).toBe(2n * Q96)
    expect(getNextSqrtPriceFromAmount1RoundingDown(Q96, 3n, 1n, true)).toBe(Q96 + Q96 / 3n)
  })

  it('from token0 input: L·√P/(L + Δ0·√P), rounded up', () => {
    const expected = divRoundingUp(2n * Q96, 3n)
    expect(getNextSqrtPriceFromInput(Q96, 1000n, 500n, true)).toBe(expected)
    expect(getNextSqrtPriceFromAmount0RoundingUp(Q96, 1000n, 0n, true)).toBe(Q96)
  })

  it('from outputs (inverse direction)', () => {
    expect(getNextSqrtPriceFromOutput(2n * Q96, 1000n, 1000n, true)).toBe(Q96)
    expect(getNextSqrtPriceFromOutput(Q96, 1000n, 500n, false)).toBe(2n * Q96)
    expect(() => getNextSqrtPriceFromOutput(Q96, 1000n, 1000n, false)).toThrow(RangeError)
    expect(() => getNextSqrtPriceFromAmount1RoundingDown(Q96, 1000n, 1000n, false)).toThrow(
      RangeError,
    )
  })

  it('rejects zero liquidity / price', () => {
    expect(() => getNextSqrtPriceFromInput(Q96, 0n, 1n, true)).toThrow(RangeError)
    expect(() => getNextSqrtPriceFromInput(0n, 1n, 1n, true)).toThrow(RangeError)
  })

  it('agrees with the deltas: moving by the delta reaches the price', () => {
    const start = 123_456_789n * Q96
    const end = 123_456_000n * Q96
    const liquidity = 10n ** 20n
    // a rounded-up input moves the price at least to `end`, a rounded-down one not quite
    const upIn = getAmount0Delta(end, start, liquidity, true)
    const nextUp = getNextSqrtPriceFromInput(start, liquidity, upIn, true)
    expect(nextUp <= end).toBe(true)
    expect(getAmount0Delta(nextUp, end, liquidity, false) <= 1n).toBe(true)
    const downIn = getAmount0Delta(end, start, liquidity, false)
    const nextDown = getNextSqrtPriceFromInput(start, liquidity, downIn, true)
    expect(nextDown >= end).toBe(true)
    expect(getAmount0Delta(end, nextDown, liquidity, false) <= 1n).toBe(true)
    // same for token1 input going up
    const up1 = getAmount1Delta(start, end + 10n ** 20n, liquidity, true)
    const next1 = getNextSqrtPriceFromInput(start, liquidity, up1, false)
    expect(next1 >= end + 10n ** 20n).toBe(true)
  })
})

describe('computeSwapStep', () => {
  it('reaching the target: fee = ceil(amountIn·fee/(1e6 − fee))', () => {
    const step = computeSwapStep(Q96, 2n * Q96, 1000n, 10_000n, 3000)
    expect(step.sqrtRatioNextX96).toBe(2n * Q96)
    expect(step.amountIn).toBe(1000n)
    expect(step.amountOut).toBe(500n)
    expect(step.feeAmount).toBe(4n) // ceil(1000 · 3000 / 997000) = ceil(3.009)
  })

  it('not reaching the target: the remainder of the input is the fee', () => {
    const step = computeSwapStep(Q96, 2n * Q96, 1000n, 500n, 3000)
    expect(step.sqrtRatioNextX96 < 2n * Q96).toBe(true)
    expect(step.sqrtRatioNextX96 > Q96).toBe(true)
    expect(step.amountIn).toBe(498n) // floor(500 · 997000 / 1e6)
    expect(step.feeAmount).toBe(2n)
    expect(step.amountIn + step.feeAmount).toBe(500n)
    expect(step.amountOut).toBe(getAmount0Delta(Q96, step.sqrtRatioNextX96, 1000n, false))
  })

  it('zero liquidity jumps to the target for free', () => {
    const step = computeSwapStep(Q96, 2n * Q96, 0n, 500n, 3000)
    expect(step.sqrtRatioNextX96).toBe(2n * Q96)
    expect(step.amountIn).toBe(0n)
    expect(step.amountOut).toBe(0n)
    expect(step.feeAmount).toBe(0n)
  })

  it('zeroForOne direction is inferred from the target side', () => {
    const step = computeSwapStep(2n * Q96, Q96, 1000n, 10_000n, 500)
    expect(step.sqrtRatioNextX96).toBe(Q96)
    expect(step.amountIn).toBe(500n)
    expect(step.amountOut).toBe(1000n)
    expect(step.feeAmount).toBe(1n) // ceil(500 · 500 / 999500)
  })

  it('a dust input is entirely consumed by the fee', () => {
    const step = computeSwapStep(Q96, 2n * Q96, 1000n, 1n, 3000)
    expect(step.sqrtRatioNextX96).toBe(Q96)
    expect(step.amountIn).toBe(0n)
    expect(step.amountOut).toBe(0n)
    expect(step.feeAmount).toBe(1n)
  })

  it('a 100 % fee (Uniswap v4 MAX_LP_FEE) is valid: the whole input is fee, no price move', () => {
    const step = computeSwapStep(Q96, 2n * Q96, 1000n, 500n, 1_000_000)
    expect(step.sqrtRatioNextX96).toBe(Q96)
    expect(step.amountIn).toBe(0n)
    expect(step.amountOut).toBe(0n)
    expect(step.feeAmount).toBe(500n)
    const down = computeSwapStep(2n * Q96, Q96, 1000n, 1n, 1_000_000)
    expect(down.sqrtRatioNextX96).toBe(2n * Q96)
    expect(down.feeAmount).toBe(1n)
    // the target is reached only when amountIn is 0 (zero liquidity / no move): fee = amountIn = 0
    const free = computeSwapStep(Q96, 2n * Q96, 0n, 500n, 1_000_000)
    expect(free.sqrtRatioNextX96).toBe(2n * Q96)
    expect(free.amountIn).toBe(0n)
    expect(free.feeAmount).toBe(0n)
    const still = computeSwapStep(Q96, Q96, 1000n, 500n, 1_000_000)
    expect(still.sqrtRatioNextX96).toBe(Q96)
    expect(still.amountIn).toBe(0n)
    expect(still.feeAmount).toBe(0n)
  })

  it('rejects invalid inputs', () => {
    expect(() => computeSwapStep(Q96, 2n * Q96, 1n, -1n, 3000)).toThrow(RangeError)
    expect(() => computeSwapStep(Q96, 2n * Q96, 1n, 1n, 1_000_001)).toThrow(RangeError)
    expect(() => computeSwapStep(Q96, 2n * Q96, 1n, 1n, -1)).toThrow(RangeError)
  })
})
