import { describe, expect, it } from 'vitest'
import { absBigint, numberToFraction, pow10, WAD } from '../math.js'
import { computeDepth } from '../metrics/depth.js'
import { computeEffectiveSpread } from '../metrics/spread.js'
import { applySwap, bruteForceSwapToPrice, buildStableSwapState, makeToken } from '../testing.js'
import type { StableSwapState, SwapDirection } from '../types.js'
import { simulateSwapExactIn, simulateSwapToPrice } from './index.js'
import { midPrice } from './midPrice.js'
import {
  _d,
  _f,
  _get_y,
  _k,
  normalisedReserves,
  StableSwapNonConvergence,
  simulateStableExactIn,
  simulateStableToPrice,
  stableGetAmountOut,
  stableMarginalPrice,
  stableMarginalPriceFraction,
} from './stableSwap.js'

const E18 = pow10(18)
const E6 = pow10(6)

describe('invariant helpers', () => {
  it('_k normalises by decimals and equals _f on normalised reserves', () => {
    const x = 10n ** 12n // 1e6 USDC (6 dec)
    const y = 10n ** 24n // 1e6 DAI (18 dec)
    expect(_k(x, y, E6, E18)).toBe(_f(10n ** 24n, 10n ** 24n))
    // x³y + xy³ with x = y = 1e6 (1e18 units): 2 · 1e6^4 · 1e18
    expect(_f(10n ** 24n, 10n ** 24n)).toBe(
      (2n * 10n ** 24n * 10n ** 24n * 10n ** 24n * 10n ** 24n) / (E18 * E18 * E18),
    )
    expect(_d(E18, E18)).toBe(4n * E18) // 3x y² + x³ at x = y = 1
  })

  it('_get_y finds y with f(x0, y) ≥ xy and f(x0, y − 1) < xy', () => {
    const x0 = 10n ** 24n + 10n ** 21n
    const xy = _f(10n ** 24n, 10n ** 24n)
    const y = _get_y(x0, xy, 10n ** 24n, E18, E18)
    expect(_f(x0, y) >= xy).toBe(true)
    expect(_f(x0, y - 1n) < xy).toBe(true)
    expect(y < 10n ** 24n).toBe(true)
  })
})

describe('getAmountOut', () => {
  it('a small trade on a balanced 1e6/1e6 pool returns ≈ amountIn·(1 − fee)', () => {
    const state = buildStableSwapState(10n ** 24n, 10n ** 24n, 18, 18, 500)
    const amountIn = 10n ** 21n // 1000 units
    const out = stableGetAmountOut(state, 'zeroForOne', amountIn)
    const expected = (amountIn * 9995n) / 10000n
    expect(out <= expected).toBe(true)
    expect(Number(expected - out) / Number(expected)).toBeLessThan(1e-6)
    const r = simulateStableExactIn(state, 'zeroForOne', amountIn)
    expect(r.amountOut).toBe(out)
    expect(r.feePaid).toBe(amountIn / 2000n)
    expect(r.complete).toBe(true)
    expect(simulateSwapExactIn(state, 'oneForZero', amountIn).amountOut).toBe(out)
  })

  it('preserves k = x³y + xy³ (never below, within tolerance)', () => {
    const state = buildStableSwapState(10n ** 24n, 10n ** 24n, 18, 18, 500)
    const before = _k(state.reserve0, state.reserve1, E18, E18)
    for (const amountIn of [10n ** 18n, 10n ** 21n, 10n ** 23n, 5n * 10n ** 23n]) {
      const r = simulateStableExactIn(state, 'zeroForOne', amountIn)
      const next = applySwap(state, r)
      if (next.kind !== 'stable-swap') throw new Error('kind')
      const after = _k(next.reserve0, next.reserve1, E18, E18)
      expect(after >= before).toBe(true)
      expect(Number(after - before) / Number(before)).toBeLessThan(1e-12)
    }
  })

  it('works with mixed decimals (6 vs 18)', () => {
    const state = buildStableSwapState(10n ** 12n, 10n ** 24n, 6, 18, 500)
    const amountIn = 10n ** 9n // 1000 USDC
    const out = simulateSwapExactIn(state, 'zeroForOne', amountIn).amountOut
    const expected = (10n ** 21n * 9995n) / 10000n // 999.5 DAI in 18 dec
    expect(Number(expected - out) / Number(expected)).toBeLessThan(1e-6)
    expect(out <= expected).toBe(true)
    const back = simulateSwapExactIn(state, 'oneForZero', 10n ** 21n).amountOut
    expect(Number(back) / 1e9).toBeCloseTo(0.9995, 5)
    const before = _k(state.reserve0, state.reserve1, E6, E18)
    const next = applySwap(state, simulateSwapExactIn(state, 'zeroForOne', amountIn))
    if (next.kind !== 'stable-swap') throw new Error('kind')
    expect(_k(next.reserve0, next.reserve1, E6, E18) >= before).toBe(true)
  })

  it('empty pool is incomplete, negative input throws', () => {
    const empty = buildStableSwapState(0n, 10n ** 24n, 18, 18, 500)
    expect(simulateStableExactIn(empty, 'zeroForOne', 1n).complete).toBe(false)
    expect(() => simulateStableExactIn(empty, 'zeroForOne', -1n)).toThrow(RangeError)
  })
})

describe('marginal price', () => {
  it('is 1 for a balanced pool and 13/14 at 2:1', () => {
    expect(stableMarginalPrice(buildStableSwapState(10n ** 24n, 10n ** 24n, 18, 18, 500))).toBe(1)
    expect(stableMarginalPrice(buildStableSwapState(10n ** 12n, 10n ** 24n, 6, 18, 500))).toBe(1)
    const skewed = buildStableSwapState(2n * 10n ** 24n, 10n ** 24n, 18, 18, 500)
    expect(stableMarginalPrice(skewed)).toBeCloseTo(13 / 14, 12)
    expect(midPrice(skewed, 18, 18)).toBeCloseTo(13 / 14, 12)
    expect(stableMarginalPrice(buildStableSwapState(0n, 0n, 18, 18, 500))).toBeNaN()
  })
})

describe('swap to price (bisection)', () => {
  const state = buildStableSwapState(10n ** 12n, 10n ** 24n, 6, 18, 500)

  it('moves the marginal price to the target in both directions', () => {
    for (const target of [0.99, 0.95, 1.01, 1.05]) {
      const r = simulateStableToPrice(state, target)
      expect(r.direction).toBe(target > 1 ? 'oneForZero' : 'zeroForOne')
      expect(r.complete).toBe(true)
      expect(r.amountIn > 0n).toBe(true)
      const after = applySwap(state, r)
      if (after.kind !== 'stable-swap') throw new Error('kind')
      expect(stableMarginalPrice(after) / target).toBeCloseTo(1, 5)
      expect(simulateSwapToPrice(state, target, { decimals0: 6, decimals1: 18 }).amountIn).toBe(
        r.amountIn,
      )
    }
  })

  it('agrees with the brute force within one step', () => {
    const target = 0.97
    const r = simulateStableToPrice(state, target)
    const step = r.amountIn / 500n + 1n
    const brute = bruteForceSwapToPrice(state, target, step)
    expect(brute.complete).toBe(true)
    expect(absBigint(brute.amountIn - r.amountIn) <= step + 500n).toBe(true)
  })

  it('a 5 % move on a stable pool needs a large share of the reserves', () => {
    const r = simulateStableToPrice(state, 0.95)
    expect(Number(r.amountIn) / Number(state.reserve0)).toBeGreaterThan(0.2)
    expect(Number(r.amountIn) / Number(state.reserve0)).toBeLessThan(0.5)
  })

  it('degenerate inputs', () => {
    expect(simulateStableToPrice(state, 1).amountIn).toBe(0n)
    expect(simulateStableToPrice(buildStableSwapState(0n, 0n, 18, 18, 500), 2).complete).toBe(false)
    expect(() => simulateStableToPrice(state, -1)).toThrow(RangeError)
  })

  it('the WAD constant is 1e18', () => {
    expect(WAD).toBe(10n ** 18n)
  })
})

/** Exact: has the pool's marginal price after a gross input `a` passed `target`? */
function passedExactly(
  state: StableSwapState,
  direction: SwapDirection,
  a: bigint,
  target: number,
): boolean {
  const after = applySwap(state, simulateStableExactIn(state, direction, a))
  if (after.kind !== 'stable-swap') throw new Error('kind')
  const { x, y } = normalisedReserves(after)
  const { num, den } = stableMarginalPriceFraction(x, y)
  const { num: tNum, den: tDen } = numberToFraction(target)
  return direction === 'zeroForOne' ? num * tDen <= tNum * den : num * tDen >= tNum * den
}

/** Reference: plain bisection on the exact predicate, independent of the implementation. */
function referenceToPrice(state: StableSwapState, target: number): bigint {
  const direction: SwapDirection = target > stableMarginalPrice(state) ? 'oneForZero' : 'zeroForOne'
  if (passedExactly(state, direction, 0n, target)) return 0n
  let lo = 0n
  let hi = 1n
  while (!passedExactly(state, direction, hi, target)) {
    lo = hi
    hi *= 2n
  }
  while (hi - lo > 1n) {
    const m = (lo + hi) >> 1n
    if (passedExactly(state, direction, m, target)) hi = m
    else lo = m
  }
  return hi
}

describe('swap to price is exact (analytic marginal price of the post-trade reserves)', () => {
  const pools: Array<[string, StableSwapState]> = [
    ['USDC(6)/DAI(18) $100', buildStableSwapState(10n ** 8n, 10n ** 20n, 6, 18, 500)],
    ['USDC(6)/DAI(18) $1k', buildStableSwapState(10n ** 9n, 10n ** 21n, 6, 18, 500)],
    ['USDC(6)/DAI(18) $10k', buildStableSwapState(10n ** 10n, 10n ** 22n, 6, 18, 500)],
    ['USDC(6)/USDbC(6) $100', buildStableSwapState(10n ** 8n, 10n ** 8n, 6, 6, 500)],
    ['USDC(6)/USDbC(6) $1k', buildStableSwapState(10n ** 9n, 10n ** 9n, 6, 6, 500)],
    ['USDC(6)/USDbC(6) $10k', buildStableSwapState(10n ** 10n, 10n ** 10n, 6, 6, 500)],
    ['DAI/DAI $1M', buildStableSwapState(10n ** 24n, 10n ** 24n, 18, 18, 500)],
  ]

  it.each(pools)('%s: minimal input to 1 wei, never a zero "reached" level', (_name, state) => {
    for (const target of [1.01, 1.02, 0.99, 0.98]) {
      const r = simulateStableToPrice(state, target)
      expect(r.direction).toBe(target > 1 ? 'oneForZero' : 'zeroForOne')
      expect(r.complete).toBe(true)
      expect(r.amountIn > 0n).toBe(true)
      // the input reaches the target and one wei less does not
      expect(passedExactly(state, r.direction, r.amountIn, target)).toBe(true)
      expect(passedExactly(state, r.direction, r.amountIn - 1n, target)).toBe(false)
      expect(absBigint(r.amountIn - referenceToPrice(state, target)) <= 1n).toBe(true)
      const after = applySwap(state, r)
      if (after.kind !== 'stable-swap') throw new Error('kind')
      expect(stableMarginalPrice(after) / target).toBeCloseTo(1, 4)
      // the result is a genuine exact-in swap of that size
      const replay = simulateStableExactIn(state, r.direction, r.amountIn)
      expect(replay.amountOut).toBe(r.amountOut)
      expect(replay.feePaid).toBe(r.feePaid)
    }
  })

  it('DAI/DAI 1e24 to 0.99 is not short by half the old finite-difference step', () => {
    const state = buildStableSwapState(10n ** 24n, 10n ** 24n, 18, 18, 500)
    const r = simulateStableToPrice(state, 0.99)
    expect(r.amountIn).toBe(171621527972519034091101n)
  })

  it('a $100 USDC/DAI pool reports a real +1 % depth (not amountIn 0, complete true)', () => {
    const state = buildStableSwapState(10n ** 8n, 10n ** 20n, 6, 18, 500)
    const r = simulateStableToPrice(state, 1.01)
    expect(r.complete).toBe(true)
    expect(r.amountIn).toBe(17104778002580056194n) // ≈ 17.1 DAI
    const level = computeDepth(state, 6, 18, [1])[0]
    expect(level?.up.reached).toBe(true)
    expect(level?.up.amountIn).toBe(r.amountIn)
  })
})

describe('dust reserves (the contract reverts: division by zero in _get_y)', () => {
  const dust = buildStableSwapState(1000n, 1000n, 18, 18, 500)

  it('_get_y throws the typed error instead of a bare RangeError', () => {
    expect(_d(1000n, 1000n)).toBe(0n)
    expect(() => _get_y(1000n, 0n, 1000n, E18, E18)).toThrow(StableSwapNonConvergence)
  })

  it('exact-in and swap-to-price are incomplete, not exceptions', () => {
    expect(simulateStableExactIn(dust, 'zeroForOne', 1n)).toEqual({
      direction: 'zeroForOne',
      amountIn: 0n,
      amountOut: 0n,
      feePaid: 0n,
      complete: false,
    })
    const r = simulateStableToPrice(dust, 0.99)
    expect(r.complete).toBe(false)
    expect(r.amountIn).toBe(0n)
    expect(simulateStableToPrice(dust, 1.01).complete).toBe(false)
    for (const reserve of [10n ** 8n, 10n ** 9n, 10n ** 11n]) {
      const s = buildStableSwapState(reserve, reserve, 18, 18, 500)
      expect(simulateStableExactIn(s, 'oneForZero', 1n).complete).toBe(false)
    }
    // 1e12 wei (1e-6 tokens) is the first reserve the contract's math can handle
    expect(
      simulateStableExactIn(
        buildStableSwapState(10n ** 12n, 10n ** 12n, 18, 18, 500),
        'zeroForOne',
        1n,
      ).complete,
    ).toBe(true)
  })

  it('metrics on a dust pool do not throw: depth is unreached, spread is computed or null', () => {
    const levels = computeDepth(dust, 18, 18)
    for (const level of levels) {
      expect(level.up).toEqual({ amountIn: 0n, amountOut: 0n, reached: false })
      expect(level.down).toEqual({ amountIn: 0n, amountOut: 0n, reached: false })
    }
    const usdc = makeToken('USDC', 18)
    const dai = makeToken('DAI', 18)
    expect(() => computeEffectiveSpread(dust, usdc, dai, 1, 1)).not.toThrow()
    const asymmetric = buildStableSwapState(10n ** 12n, 10n ** 11n, 18, 18, 500)
    expect(() => computeDepth(asymmetric, 18, 18)).not.toThrow()
    expect(() => computeEffectiveSpread(asymmetric, usdc, dai, 1, 1)).not.toThrow()
  })
})
