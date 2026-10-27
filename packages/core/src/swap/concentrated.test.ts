import { describe, expect, it } from 'vitest'
import { absBigint, Q96 } from '../math.js'
import { computeDepth } from '../metrics/depth.js'
import { computeSwapStep, getAmount0Delta, getAmount1Delta } from '../sqrtPriceMath.js'
import { bruteForceSwapToPrice, buildConcentratedState } from '../testing.js'
import {
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  priceToSqrtPriceX96,
} from '../tickMath.js'
import type { ConcentratedState } from '../types.js'
import {
  type ConcentratedSwapResult,
  liquidityAtTick,
  simulateConcentratedExactIn,
  simulateConcentratedToSqrtPrice,
} from './concentrated.js'
import { simulateSwapExactIn, simulateSwapToPrice } from './index.js'
import { midPrice } from './midPrice.js'

const EQ = { decimals0: 18, decimals1: 18 }
const L = 10n ** 21n

function singleRange(feePips = 3000): ConcentratedState {
  return buildConcentratedState({
    positions: [{ tickLower: -6000, tickUpper: 6000, liquidity: L }],
    tick: 0,
    feePips,
    tickSpacing: 60,
  })
}

function multiRange(): ConcentratedState {
  return buildConcentratedState({
    positions: [
      { tickLower: -600, tickUpper: 600, liquidity: L },
      { tickLower: -60, tickUpper: 60, liquidity: 5n * L },
      { tickLower: 120, tickUpper: 1200, liquidity: 2n * L },
    ],
    tick: 0,
    feePips: 500,
    tickSpacing: 60,
  })
}

describe('single-range walk vs closed form', () => {
  it('oneForZero: token1 in, price up, token0 out', () => {
    const state = singleRange()
    const amountIn = 10n ** 18n
    const r = simulateConcentratedExactIn(state, 'oneForZero', amountIn)
    const net = (amountIn * 997_000n) / 1_000_000n
    const sqrtNext = state.sqrtPriceX96 + (net * Q96) / L
    const out0 = (L * Q96 * (sqrtNext - state.sqrtPriceX96)) / (state.sqrtPriceX96 * sqrtNext)
    expect(r.complete).toBe(true)
    expect(r.amountIn).toBe(amountIn)
    expect(r.feePaid).toBe(amountIn - net)
    expect(r.sqrtPriceAfterX96).toBe(sqrtNext)
    expect(r.amountOut).toBe(out0)
    expect(r.tickAfter).toBe(getTickAtSqrtRatio(sqrtNext))
    expect(r.liquidityAfter).toBe(L)
    expect(r.ticksCrossed).toBe(0)
  })

  it('zeroForOne: token0 in, price down, token1 out (rounded in the pool favour)', () => {
    const state = singleRange()
    const amountIn = 10n ** 18n
    const r = simulateConcentratedExactIn(state, 'zeroForOne', amountIn)
    const net = (amountIn * 997_000n) / 1_000_000n
    // exact (real-number) next price: L·√P / (L + net·√P / 2^96)
    const sqrtNextIdeal = (L * Q96 * state.sqrtPriceX96) / (L * Q96 + net * state.sqrtPriceX96)
    expect(r.sqrtPriceAfterX96 - sqrtNextIdeal <= 1n).toBe(true)
    expect(r.sqrtPriceAfterX96 >= sqrtNextIdeal).toBe(true)
    const out1 = getAmount1Delta(r.sqrtPriceAfterX96, state.sqrtPriceX96, L, false)
    expect(r.amountOut).toBe(out1)
    expect(r.amountIn).toBe(amountIn)
    expect(r.complete).toBe(true)
    expect(r.direction).toBe('zeroForOne')
  })

  it('a swap to the current price does nothing', () => {
    const state = singleRange()
    const r = simulateConcentratedToSqrtPrice(state, state.sqrtPriceX96)
    expect(r.amountIn).toBe(0n)
    expect(r.amountOut).toBe(0n)
    expect(r.complete).toBe(true)
    expect(r.tickAfter).toBe(0)
  })

  it('zero input and dust input', () => {
    const state = singleRange()
    const zero = simulateConcentratedExactIn(state, 'oneForZero', 0n)
    expect(zero.amountIn).toBe(0n)
    expect(zero.complete).toBe(true)
    const dust = simulateConcentratedExactIn(state, 'oneForZero', 1n)
    expect(dust.amountIn).toBe(1n)
    expect(dust.feePaid).toBe(1n)
    expect(dust.amountOut).toBe(0n)
    expect(dust.sqrtPriceAfterX96).toBe(state.sqrtPriceX96)
    expect(dust.complete).toBe(true)
    expect(() => simulateConcentratedExactIn(state, 'oneForZero', -1n)).toThrow(RangeError)
  })
})

describe('multi-range walk', () => {
  it('crosses initialised ticks, applying liquidityNet, and matches the brute force', () => {
    const state = multiRange()
    const mid = midPrice(state, 18, 18)
    const target = mid * 1.05
    const r = simulateSwapToPrice(state, target, EQ) as ConcentratedSwapResult
    expect(r.complete).toBe(true)
    expect(r.direction).toBe('oneForZero')
    expect(r.sqrtPriceAfterX96).toBe(priceToSqrtPriceX96(target, 18, 18))
    expect(r.ticksCrossed).toBe(2) // 60 and 120
    expect(r.liquidityAfter).toBe(3n * L)
    expect(r.liquidityAfter).toBe(liquidityAtTick(state, r.tickAfter))
    const steps = 2000n
    const step = r.amountIn / steps + 1n
    const brute = bruteForceSwapToPrice(state, target, step, EQ)
    expect(brute.complete).toBe(true)
    expect(brute.amountIn >= r.amountIn).toBe(true)
    expect(brute.amountIn - r.amountIn <= step + 4n * BigInt(brute.steps)).toBe(true)
    const same = simulateSwapExactIn(state, r.direction, brute.amountIn)
    expect(absBigint(brute.amountOut - same.amountOut) <= 4n * BigInt(brute.steps)).toBe(true)
    expect(brute.finalState.kind === 'concentrated' && brute.finalState.liquidity).toBe(3n * L)
  })

  it('moving down lands exactly on an initialised tick and crosses it (tick − 1)', () => {
    const state = multiRange()
    const r = simulateConcentratedToSqrtPrice(state, getSqrtRatioAtTick(-60))
    expect(r.complete).toBe(true)
    expect(r.sqrtPriceAfterX96).toBe(getSqrtRatioAtTick(-60))
    expect(r.tickAfter).toBe(-61)
    expect(r.liquidityAfter).toBe(L) // the 5L position was crossed on landing
    expect(r.ticksCrossed).toBe(1)
    // moving up to an initialised tick leaves the tick at the boundary itself
    const up = simulateConcentratedToSqrtPrice(state, getSqrtRatioAtTick(60))
    expect(up.tickAfter).toBe(60)
    expect(up.liquidityAfter).toBe(L)
  })

  it('starting exactly on an initialised tick and moving down crosses it first', () => {
    const state = buildConcentratedState({
      positions: [
        { tickLower: -600, tickUpper: 600, liquidity: L },
        { tickLower: -60, tickUpper: 60, liquidity: 5n * L },
      ],
      tick: -60,
      feePips: 500,
      tickSpacing: 60,
    })
    expect(state.liquidity).toBe(6n * L)
    const amountIn = 10n ** 18n
    const r = simulateConcentratedExactIn(state, 'zeroForOne', amountIn)
    expect(r.liquidityAfter).toBe(L)
    expect(r.tickAfter < -60).toBe(true)
    expect(r.ticksCrossed).toBe(1)
    // identical to a pool that only has the wide position, priced at the same point
    const reference = buildConcentratedState({
      positions: [{ tickLower: -600, tickUpper: 600, liquidity: L }],
      tick: -60,
      feePips: 500,
      tickSpacing: 60,
    })
    const rr = simulateConcentratedExactIn(reference, 'zeroForOne', amountIn)
    expect(rr.amountOut).toBe(r.amountOut)
    expect(rr.sqrtPriceAfterX96).toBe(r.sqrtPriceAfterX96)
  })

  it('jumps across a zero-liquidity gap for free', () => {
    const gap = buildConcentratedState({
      positions: [
        { tickLower: -600, tickUpper: -300, liquidity: L },
        { tickLower: 300, tickUpper: 600, liquidity: L },
      ],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    expect(gap.liquidity).toBe(0n)
    const amountIn = 10n ** 18n
    const r = simulateConcentratedExactIn(gap, 'oneForZero', amountIn)
    const reference = buildConcentratedState({
      positions: [{ tickLower: 300, tickUpper: 600, liquidity: L }],
      tick: 300,
      feePips: 3000,
      tickSpacing: 60,
    })
    const rr = simulateConcentratedExactIn(reference, 'oneForZero', amountIn)
    expect(r.amountOut).toBe(rr.amountOut)
    expect(r.sqrtPriceAfterX96).toBe(rr.sqrtPriceAfterX96)
    expect(r.complete).toBe(true)
    expect(r.ticksCrossed).toBe(1)
  })
})

describe('liquidity exhaustion and bounds', () => {
  it('swap-to-price beyond the last position is incomplete and stops at the bound', () => {
    const state = singleRange()
    const mid = midPrice(state, 18, 18)
    const r = simulateSwapToPrice(state, mid * 3, EQ) as ConcentratedSwapResult
    expect(r.complete).toBe(false)
    expect(r.boundHit).toBe(true)
    expect(r.tickAfter).toBe(6001)
    expect(r.sqrtPriceAfterX96).toBe(getSqrtRatioAtTick(6001))
    expect(r.liquidityAfter).toBe(0n)
    const inRange = getAmount1Delta(state.sqrtPriceX96, getSqrtRatioAtTick(6000), L, true)
    expect(r.amountIn - r.feePaid).toBe(inRange)
    expect(r.amountOut).toBe(
      getAmount0Delta(state.sqrtPriceX96, getSqrtRatioAtTick(6000), L, false),
    )
  })

  it('exact-in larger than the pool consumes only what the liquidity can take', () => {
    const state = singleRange()
    const r = simulateConcentratedExactIn(state, 'zeroForOne', 10n ** 30n)
    expect(r.complete).toBe(false)
    expect(r.boundHit).toBe(true)
    expect(r.amountIn < 10n ** 30n).toBe(true)
    expect(r.tickAfter).toBe(-6001)
    expect(r.amountOut).toBe(
      getAmount1Delta(getSqrtRatioAtTick(-6000), state.sqrtPriceX96, L, false),
    )
  })

  it('stops at tickUpperBound / tickLowerBound even when positions extend further', () => {
    const state = { ...singleRange(), tickLowerBound: -300, tickUpperBound: 300 }
    const up = simulateConcentratedExactIn(state, 'oneForZero', 10n ** 30n)
    expect(up.complete).toBe(false)
    expect(up.boundHit).toBe(true)
    expect(up.tickAfter).toBe(301)
    expect(up.sqrtPriceAfterX96).toBe(getSqrtRatioAtTick(301))
    const down = simulateConcentratedExactIn(state, 'zeroForOne', 10n ** 30n)
    expect(down.complete).toBe(false)
    expect(down.tickAfter).toBe(-301)
    expect(down.sqrtPriceAfterX96).toBe(getSqrtRatioAtTick(-300))
    // a target inside the bounds is still reached normally
    const inside = simulateConcentratedToSqrtPrice(state, getSqrtRatioAtTick(200))
    expect(inside.complete).toBe(true)
    expect(inside.tickAfter).toBe(200)
  })

  it('ignores ticks outside the bounds (never extrapolates)', () => {
    const state = { ...multiRange(), tickUpperBound: 100 }
    const r = simulateConcentratedExactIn(state, 'oneForZero', 10n ** 30n)
    expect(r.ticksCrossed).toBe(1) // only tick 60; tick 120 is unknown
    expect(r.tickAfter).toBe(101)
    expect(r.liquidityAfter).toBe(L)
  })

  it('a pool pinned at MIN_TICK cannot be sold into; an inconsistent tick throws', () => {
    const pinned = buildConcentratedState({
      positions: [{ tickLower: MIN_TICK, tickUpper: MIN_TICK + 1000, liquidity: L }],
      tick: MIN_TICK,
      feePips: 3000,
      tickSpacing: 1,
    })
    const r = simulateConcentratedExactIn(pinned, 'zeroForOne', 10n ** 18n)
    expect(r.amountIn).toBe(0n)
    expect(r.complete).toBe(false)
    expect(r.sqrtPriceAfterX96).toBe(pinned.sqrtPriceX96)
    const inconsistent = { ...multiRange(), tick: 100 } // price says tick 0
    expect(() => simulateConcentratedExactIn(inconsistent, 'zeroForOne', 10n ** 18n)).toThrow(
      /inconsistent/,
    )
  })

  it('throws when crossing a tick would make liquidity negative', () => {
    const broken: ConcentratedState = {
      ...singleRange(),
      ticks: [{ index: 600, liquidityNet: -2n * L, liquidityGross: 2n * L }],
    }
    expect(() => simulateConcentratedExactIn(broken, 'oneForZero', 10n ** 30n)).toThrow(/underflow/)
  })
})

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('property: swap-to-price equals many small exact-in swaps', () => {
  const random = rng(20251023)
  const spacings = [10, 60, 200]
  const fees = [500, 3000, 10000]
  const cases: Array<{ state: ConcentratedState; pct: number }> = []
  for (let i = 0; i < 12; i++) {
    const spacing = spacings[i % spacings.length] ?? 60
    const align = (t: number) => Math.round(t / spacing) * spacing
    const tick = align(Math.floor(random() * 200_000) - 100_000)
    const wide = BigInt(Math.floor(10 ** (18 + random() * 3)))
    const positions = [
      { tickLower: align(tick - 4000), tickUpper: align(tick + 4000), liquidity: wide },
    ]
    const n = 1 + Math.floor(random() * 4)
    for (let j = 0; j < n; j++) {
      const a = align(tick + Math.floor((random() - 0.5) * 3000))
      const b = align(tick + Math.floor((random() - 0.5) * 3000))
      if (a === b) continue
      const ratio = 0.25 + random() * 2.25
      positions.push({
        tickLower: Math.min(a, b),
        tickUpper: Math.max(a, b),
        liquidity: (wide * BigInt(Math.floor(ratio * 1000))) / 1000n,
      })
    }
    const state = buildConcentratedState({
      positions,
      tick,
      feePips: fees[i % fees.length] ?? 3000,
      tickSpacing: spacing,
    })
    cases.push({ state, pct: 0.5 + random() * 4.5 })
  }

  it.each(cases.map((c, i) => [i, c] as const))('pool %i', (_i, { state, pct }) => {
    const mid = midPrice(state, 18, 18)
    for (const target of [mid * (1 + pct / 100), mid * (1 - pct / 100)]) {
      const targetSqrt = priceToSqrtPriceX96(target, 18, 18)
      const r = simulateSwapToPrice(state, target, EQ) as ConcentratedSwapResult
      expect(r.complete).toBe(true)
      expect(r.sqrtPriceAfterX96).toBe(targetSqrt)
      expect(Math.abs(r.tickAfter - getTickAtSqrtRatio(targetSqrt))).toBeLessThanOrEqual(1)
      expect(r.liquidityAfter).toBe(liquidityAtTick(state, r.tickAfter))
      const steps = 2000n
      const step = r.amountIn / steps + 1n
      const brute = bruteForceSwapToPrice(state, target, step, EQ)
      expect(brute.complete).toBe(true)
      const slack = 4n * BigInt(brute.steps)
      // one wei of input rounding per step is worth up to `price` wei of output
      const slackOut = slack * (r.amountOut / r.amountIn + 1n)
      // the brute force overshoots the target by at most one step (plus rounding)
      expect(brute.amountIn >= r.amountIn - slack).toBe(true)
      expect(brute.amountIn - r.amountIn <= step + slack).toBe(true)
      const final = brute.finalState
      if (final.kind !== 'concentrated') throw new Error('unexpected kind')
      expect(Math.abs(final.tick - getTickAtSqrtRatio(targetSqrt))).toBeLessThanOrEqual(3)
      // many small exact-in swaps ≈ one exact-in swap of the same total, to a few wei per step
      const same = simulateSwapExactIn(state, r.direction, brute.amountIn) as ConcentratedSwapResult
      expect(same.complete).toBe(true)
      expect(absBigint(same.amountOut - brute.amountOut) <= slackOut).toBe(true)
      expect(Math.abs(same.tickAfter - final.tick)).toBeLessThanOrEqual(1)
      // the exact-in of the amount found reproduces the target price (within rounding)
      const replay = simulateSwapExactIn(state, r.direction, r.amountIn) as ConcentratedSwapResult
      expect(replay.complete).toBe(true)
      expect(Math.abs(replay.tickAfter - r.tickAfter)).toBeLessThanOrEqual(1)
    }
  })
})

/**
 * Literal port of TickBitmap.nextInitializedTickWithinOneWord over a set of initialised ticks:
 * the next initialised tick in the swap direction, or the edge of the current 256-slot word.
 */
function nextInitializedTickWithinOneWord(
  initialised: ReadonlySet<number>,
  tick: number,
  tickSpacing: number,
  lte: boolean,
): { next: number; initialized: boolean } {
  let compressed = Math.trunc(tick / tickSpacing)
  if (tick < 0 && tick % tickSpacing !== 0) compressed-- // round towards negative infinity
  if (lte) {
    const wordPos = compressed >> 8
    const bitPos = compressed - wordPos * 256
    for (let b = bitPos; b >= 0; b--) {
      const candidate = (wordPos * 256 + b) * tickSpacing
      if (initialised.has(candidate)) return { next: candidate, initialized: true }
    }
    return { next: (compressed - bitPos) * tickSpacing, initialized: false }
  }
  const start = compressed + 1 // the current tick's state does not matter going up
  const wordPos = start >> 8
  const bitPos = start - wordPos * 256
  for (let b = bitPos; b <= 255; b++) {
    const candidate = (wordPos * 256 + b) * tickSpacing
    if (initialised.has(candidate)) return { next: candidate, initialized: true }
  }
  return { next: (start + 255 - bitPos) * tickSpacing, initialized: false }
}

/** UniswapV3Pool.swap (exact input) step by step, driven by the bitmap port above. */
function contractSwap(
  state: ConcentratedState,
  zeroForOne: boolean,
  amountSpecified: bigint,
  sqrtPriceLimitX96: bigint,
): {
  amountIn: bigint
  amountOut: bigint
  feePaid: bigint
  sqrtPrice: bigint
  tick: number
  liquidity: bigint
  steps: number
} {
  const initialised = new Set(state.ticks.map((t) => t.index))
  const liquidityNet = new Map(state.ticks.map((t) => [t.index, t.liquidityNet]))
  let sqrtPrice = state.sqrtPriceX96
  let tick = state.tick
  let liquidity = state.liquidity
  let remaining = amountSpecified
  let amountIn = 0n
  let amountOut = 0n
  let feePaid = 0n
  let steps = 0
  while (remaining > 0n && sqrtPrice !== sqrtPriceLimitX96) {
    const { next, initialized } = nextInitializedTickWithinOneWord(
      initialised,
      tick,
      state.tickSpacing,
      zeroForOne,
    )
    const tickNext = Math.min(Math.max(next, MIN_TICK), MAX_TICK)
    const sqrtPriceNext = getSqrtRatioAtTick(tickNext)
    const target = (
      zeroForOne
        ? sqrtPriceNext < sqrtPriceLimitX96
        : sqrtPriceNext > sqrtPriceLimitX96
    )
      ? sqrtPriceLimitX96
      : sqrtPriceNext
    const start = sqrtPrice
    const step = computeSwapStep(sqrtPrice, target, liquidity, remaining, state.feePips)
    sqrtPrice = step.sqrtRatioNextX96
    remaining -= step.amountIn + step.feeAmount
    amountIn += step.amountIn + step.feeAmount
    amountOut += step.amountOut
    feePaid += step.feeAmount
    steps++
    if (sqrtPrice === sqrtPriceNext) {
      if (initialized) {
        const net = liquidityNet.get(tickNext) ?? 0n
        liquidity = zeroForOne ? liquidity - net : liquidity + net
      }
      tick = zeroForOne ? tickNext - 1 : tickNext
    } else if (sqrtPrice !== start) {
      tick = getTickAtSqrtRatio(sqrtPrice)
    }
  }
  return { amountIn, amountOut, feePaid, sqrtPrice, tick, liquidity, steps }
}

function expectSameAsContract(
  state: ConcentratedState,
  r: ConcentratedSwapResult,
  zeroForOne: boolean,
  amountSpecified: bigint,
  limit: bigint,
): number {
  const c = contractSwap(state, zeroForOne, amountSpecified, limit)
  expect(r.complete).toBe(true)
  expect(r.boundHit).toBe(false)
  expect(r.amountIn).toBe(c.amountIn)
  expect(r.amountOut).toBe(c.amountOut)
  expect(r.feePaid).toBe(c.feePaid)
  expect(r.sqrtPriceAfterX96).toBe(c.sqrtPrice)
  expect(r.tickAfter).toBe(c.tick)
  expect(r.liquidityAfter).toBe(c.liquidity)
  return c.steps
}

describe('tick-bitmap word edges (UniswapV3Pool.swap step decomposition)', () => {
  // One position, spacing 1, tick 5: no initialised tick between 5 and −50, but the word edge
  // at tick 0 (going down) and at tick −1 / 255 (going up) sit in between.
  const wordState = buildConcentratedState({
    positions: [{ tickLower: -2000, tickUpper: 2000, liquidity: 10n ** 24n }],
    tick: 5,
    feePips: 100,
    tickSpacing: 1,
  })

  it('swap-to-price down across the word edge at tick 0 rounds like two contract steps', () => {
    const limit = getSqrtRatioAtTick(-50)
    const first = computeSwapStep(
      wordState.sqrtPriceX96,
      getSqrtRatioAtTick(0),
      10n ** 24n,
      (1n << 255n) - 1n,
      100,
    )
    const second = computeSwapStep(getSqrtRatioAtTick(0), limit, 10n ** 24n, (1n << 255n) - 1n, 100)
    const r = simulateConcentratedToSqrtPrice(wordState, limit)
    expect(r.complete).toBe(true)
    expect(r.sqrtPriceAfterX96).toBe(limit)
    expect(r.ticksCrossed).toBe(0)
    expect(r.amountIn).toBe(first.amountIn + first.feeAmount + second.amountIn + second.feeAmount)
    expect(r.amountOut).toBe(first.amountOut + second.amountOut)
    expect(r.feePaid).toBe(first.feeAmount + second.feeAmount)
    // the figures from the on-chain decomposition (a single step gives 2753233881215250775767 /
    // 2746771673266183050355 / 275323388121525078)
    expect(r.amountIn).toBe(2753233881215250775769n)
    expect(r.amountOut).toBe(2746771673266183050354n)
    expect(r.feePaid).toBe(275323388121525079n)
    expect(expectSameAsContract(wordState, r, true, (1n << 255n) - 1n, limit)).toBe(2)
  })

  it('swap-to-price up stops at the last slot of each word (ticks −1 and 255)', () => {
    const state = buildConcentratedState({
      positions: [{ tickLower: -2000, tickUpper: 2000, liquidity: 10n ** 24n }],
      tick: -5,
      feePips: 100,
      tickSpacing: 1,
    })
    const limit = getSqrtRatioAtTick(300)
    const r = simulateConcentratedToSqrtPrice(state, limit)
    // −5 → −1 (word −1 ends), −1 → 255 (word 0 ends), 255 → 300
    expect(expectSameAsContract(state, r, false, (1n << 255n) - 1n, limit)).toBe(3)
    expect(r.ticksCrossed).toBe(0)
  })

  it('exact-in across several words consumes and rounds exactly like the contract', () => {
    const amountIn = 10n ** 23n
    const r = simulateConcentratedExactIn(wordState, 'zeroForOne', amountIn)
    const steps = expectSameAsContract(wordState, r, true, amountIn, MIN_SQRT_RATIO + 1n)
    expect(steps).toBeGreaterThan(1)
    const up = simulateConcentratedExactIn(wordState, 'oneForZero', amountIn)
    expect(
      expectSameAsContract(wordState, up, false, amountIn, MAX_SQRT_RATIO - 1n),
    ).toBeGreaterThan(1)
  })

  it('an initialised tick on the word edge itself is crossed, not skipped', () => {
    // spacing 10: word edges every 2560 ticks; position boundary exactly at tick 2560
    const state = buildConcentratedState({
      positions: [
        { tickLower: -20_000, tickUpper: 20_000, liquidity: 10n ** 22n },
        { tickLower: 2_560, tickUpper: 5_120, liquidity: 3n * 10n ** 22n },
      ],
      tick: 2_500,
      feePips: 3000,
      tickSpacing: 10,
    })
    const limit = getSqrtRatioAtTick(2_700)
    const r = simulateConcentratedToSqrtPrice(state, limit)
    expectSameAsContract(state, r, false, (1n << 255n) - 1n, limit)
    expect(r.ticksCrossed).toBe(1)
    expect(r.liquidityAfter).toBe(4n * 10n ** 22n)
    // and back down through it: landing on 2560 puts the pool in the range below
    const back = {
      ...state,
      tick: 2_700,
      sqrtPriceX96: getSqrtRatioAtTick(2_700),
      liquidity: 4n * 10n ** 22n,
    }
    const down = simulateConcentratedToSqrtPrice(back, getSqrtRatioAtTick(2_400))
    expectSameAsContract(back, down, true, (1n << 255n) - 1n, getSqrtRatioAtTick(2_400))
    expect(down.ticksCrossed).toBe(1)
    expect(down.liquidityAfter).toBe(10n ** 22n)
  })

  it('property: the walk equals the contract loop to the wei for random pools and sizes', () => {
    const random = rng(20261023)
    const spacings = [1, 10, 60]
    for (let i = 0; i < 24; i++) {
      const spacing = spacings[i % spacings.length] ?? 1
      const align = (t: number) => Math.round(t / spacing) * spacing
      const tick = Math.floor(random() * 400_000) - 200_000
      const wide = BigInt(Math.floor(10 ** (20 + random() * 3)))
      const positions = [
        { tickLower: align(tick - 6000), tickUpper: align(tick + 6000), liquidity: wide },
      ]
      for (let j = 0; j < 3; j++) {
        const a = align(tick + Math.floor((random() - 0.5) * 2000))
        const b = align(tick + Math.floor((random() - 0.5) * 2000))
        if (a === b) continue
        positions.push({
          tickLower: Math.min(a, b),
          tickUpper: Math.max(a, b),
          liquidity: (wide * BigInt(Math.floor(random() * 3000))) / 1000n,
        })
      }
      const state = buildConcentratedState({
        positions,
        tick,
        feePips: [100, 500, 3000][i % 3] ?? 500,
        tickSpacing: spacing,
      })
      const pct = 0.5 + random() * 4
      const mid = midPrice(state, 18, 18)
      for (const target of [mid * (1 + pct / 100), mid * (1 - pct / 100)]) {
        const limit = priceToSqrtPriceX96(target, 18, 18)
        const zeroForOne = limit < state.sqrtPriceX96
        const r = simulateConcentratedToSqrtPrice(state, limit)
        expectSameAsContract(state, r, zeroForOne, (1n << 255n) - 1n, limit)
        // exact-in of a slice of that amount, in the same direction
        const amountIn = r.amountIn / 3n + 1n
        const e = simulateConcentratedExactIn(state, r.direction, amountIn)
        const edgeLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n
        expectSameAsContract(state, e, zeroForOne, amountIn, edgeLimit)
      }
    }
  })

  it('rejects a non-positive tick spacing', () => {
    expect(() =>
      simulateConcentratedExactIn({ ...wordState, tickSpacing: 0 }, 'zeroForOne', 1n),
    ).toThrow(/tickSpacing/)
  })
})

describe('100 % LP fee (Uniswap v4 MAX_LP_FEE)', () => {
  const state = buildConcentratedState({
    positions: [{ tickLower: -600, tickUpper: 600, liquidity: L }],
    tick: 0,
    feePips: 1_000_000,
    tickSpacing: 60,
  })

  it('exact-in: the whole input is fee and the price does not move', () => {
    const r = simulateConcentratedExactIn(state, 'zeroForOne', 10n ** 18n)
    expect(r.complete).toBe(true)
    expect(r.amountIn).toBe(10n ** 18n)
    expect(r.feePaid).toBe(10n ** 18n)
    expect(r.amountOut).toBe(0n)
    expect(r.sqrtPriceAfterX96).toBe(state.sqrtPriceX96)
    // standing exactly on ratio(0) and moving down, the contract first takes the free step to
    // the word edge at tick 0 (tick becomes −1), then eats the whole input as fee
    expect(r.tickAfter).toBe(-1)
    expect(expectSameAsContract(state, r, true, 10n ** 18n, MIN_SQRT_RATIO + 1n)).toBe(2)
  })

  it('swap-to-price: unreachable, reported as no depth rather than an unbounded input', () => {
    const r = simulateConcentratedToSqrtPrice(state, getSqrtRatioAtTick(-100))
    expect(r.complete).toBe(false)
    expect(r.amountIn).toBe(0n)
    expect(r.amountOut).toBe(0n)
    expect(r.feePaid).toBe(0n)
    expect(r.sqrtPriceAfterX96).toBe(state.sqrtPriceX96)
    expect(r.boundHit).toBe(false)
    const same = simulateConcentratedToSqrtPrice(state, state.sqrtPriceX96)
    expect(same.complete).toBe(true)
    expect(same.amountIn).toBe(0n)
    const levels = computeDepth(state, 18, 18, [2])
    expect(levels[0]?.up).toEqual({ amountIn: 0n, amountOut: 0n, reached: false })
    expect(levels[0]?.down).toEqual({ amountIn: 0n, amountOut: 0n, reached: false })
  })
})
