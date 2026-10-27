import { describe, expect, it } from 'vitest'
import { absBigint, numberToFraction } from '../math.js'
import {
  applySwap,
  bruteForceSwapToPrice,
  buildConstantProductState,
  buildStableSwapState,
} from '../testing.js'
import {
  constantProductAmountOut,
  simulateConstantProductExactIn,
  simulateConstantProductToPrice,
} from './constantProduct.js'
import { amountInAfterFee, feeOnAmountIn, grossUpForFee } from './fees.js'
import { simulateSwapExactIn, simulateSwapToPrice } from './index.js'
import { midPrice, RAW_PRICE_DECIMALS } from './midPrice.js'
import { simulateStableToPrice } from './stableSwap.js'

const EQ = { decimals0: 18, decimals1: 18 }

describe('fees', () => {
  it('floors the fee like Aerodrome (bps × 100 = pips)', () => {
    expect(feeOnAmountIn(1000n, 3000)).toBe(3n)
    expect(feeOnAmountIn(999n, 3000)).toBe(2n)
    expect(amountInAfterFee(1000n, 3000)).toBe(997n)
    expect(() => feeOnAmountIn(1n, 1_000_000)).toThrow(RangeError)
  })

  it('grossUpForFee is the minimal gross amount for a net target', () => {
    for (const fee of [1, 100, 500, 3000, 10000, 999_999]) {
      for (const net of [1n, 7n, 997n, 12_345n, 10n ** 18n + 1n]) {
        const gross = grossUpForFee(net, fee)
        expect(amountInAfterFee(gross, fee) >= net).toBe(true)
        expect(amountInAfterFee(gross - 1n, fee) < net).toBe(true)
      }
    }
    expect(grossUpForFee(0n, 3000)).toBe(0n)
  })
})

describe('exact in', () => {
  it('amountOut = reserveOut · net / (reserveIn + net)', () => {
    const state = buildConstantProductState(1_000_000n, 2_000_000n, 3000)
    const r = simulateConstantProductExactIn(state, 'zeroForOne', 1000n)
    expect(r.feePaid).toBe(3n)
    expect(r.amountOut).toBe((997n * 2_000_000n) / (1_000_000n + 997n))
    expect(r.amountOut).toBe(constantProductAmountOut(1_000_000n, 2_000_000n, 997n))
    expect(r.complete).toBe(true)
    const other = simulateSwapExactIn(state, 'oneForZero', 1000n)
    expect(other.amountOut).toBe((997n * 1_000_000n) / (2_000_000n + 997n))
  })

  it('an empty pool is incomplete and a negative input throws', () => {
    const empty = buildConstantProductState(0n, 2_000_000n, 3000)
    expect(simulateConstantProductExactIn(empty, 'zeroForOne', 1000n).complete).toBe(false)
    expect(() => simulateConstantProductExactIn(empty, 'zeroForOne', -1n)).toThrow(RangeError)
  })
})

describe('swap to price (closed form)', () => {
  const state = buildConstantProductState(10n ** 24n, 2n * 10n ** 24n, 3000)

  it('hits the target marginal price in both directions', () => {
    const mid = midPrice(state, 18, 18)
    expect(mid).toBe(2)
    for (const factor of [1.01, 1.02, 1.05, 0.99, 0.98, 0.95, 1.5, 0.5]) {
      const r = simulateConstantProductToPrice(state, mid * factor, EQ)
      expect(r.direction).toBe(factor > 1 ? 'oneForZero' : 'zeroForOne')
      expect(r.complete).toBe(true)
      expect(r.feePaid).toBe(feeOnAmountIn(r.amountIn, 3000))
      const after = midPrice(applySwap(state, r), 18, 18)
      expect(after / (mid * factor)).toBeCloseTo(1, 9)
      // minimality (exact): net reaches the target ratio, net − 1 does not
      const net = amountInAfterFee(r.amountIn, 3000)
      const reserveIn = factor > 1 ? state.reserve1 : state.reserve0
      const { num, den } = numberToFraction(factor)
      const [ratioNum, ratioDen] = factor > 1 ? [num, den] : [den, num]
      const reaches = (n: bigint) => (reserveIn + n) ** 2n * ratioDen >= ratioNum * reserveIn ** 2n
      expect(reaches(net)).toBe(true)
      expect(reaches(net - 1n)).toBe(false)
    }
  })

  it('matches the brute force of many small swaps', () => {
    const mid = midPrice(state, 18, 18)
    for (const target of [mid * 1.02, mid * 0.98]) {
      const r = simulateSwapToPrice(state, target, EQ)
      const step = r.amountIn / 1000n + 1n
      const brute = bruteForceSwapToPrice(state, target, step, EQ)
      expect(brute.complete).toBe(true)
      expect(brute.amountIn >= r.amountIn).toBe(true)
      expect(brute.amountIn - r.amountIn <= step).toBe(true)
      expect(absBigint(brute.amountOut - r.amountOut) <= step).toBe(true)
    }
  })

  it('respects decimals when interpreting the human target', () => {
    // 1e12 USDC(6) vs 1e24 WETH(18) raw: human price 1 WETH per USDC... token1 per token0 = 1
    const usdcWeth = buildConstantProductState(10n ** 12n, 10n ** 24n, 3000)
    expect(midPrice(usdcWeth, 6, 18)).toBe(1)
    const r = simulateSwapToPrice(usdcWeth, 1.02, { decimals0: 6, decimals1: 18 })
    expect(r.direction).toBe('oneForZero')
    expect(midPrice(applySwap(usdcWeth, r), 6, 18)).toBeCloseTo(1.02, 9)
    // with equal (zero) decimals the target is a raw price and 1.02 is far below the raw 1e12
    const raw = simulateSwapToPrice(usdcWeth, 1.02, RAW_PRICE_DECIMALS)
    expect(raw.direction).toBe('zeroForOne')
    // the same call on a stable pool is governed by the state's own decimals
    const stable = buildStableSwapState(10n ** 12n, 10n ** 24n, 6, 18, 500)
    const st = simulateSwapToPrice(stable, 1.02, { decimals0: 6, decimals1: 18 })
    expect(st.direction).toBe('oneForZero')
    expect(st.amountIn).toBe(simulateStableToPrice(stable, 1.02).amountIn)
  })

  it('requires decimals so a human target can never be read as a raw price', () => {
    // Compile-time guard (checked by tsc): an optional `decimals` would make the arity `2 | 3`,
    // which is not assignable to `3`.
    const required: Parameters<typeof simulateSwapToPrice>['length'] extends 3 ? true : never = true
    expect(required).toBe(true)
  })

  it('handles degenerate inputs', () => {
    const empty = buildConstantProductState(0n, 0n, 3000)
    const r = simulateConstantProductToPrice(empty, 1, EQ)
    expect(r.complete).toBe(false)
    expect(r.amountIn).toBe(0n)
    expect(() => simulateConstantProductToPrice(state, 0, EQ)).toThrow(RangeError)
    expect(() => simulateSwapToPrice(state, Number.NaN, EQ)).toThrow(RangeError)
    const same = simulateConstantProductToPrice(state, 2, EQ)
    expect(same.amountIn).toBe(0n)
    expect(same.complete).toBe(true)
  })
})
