import { describe, expect, it } from 'vitest'
import { simulateSwapExactIn } from './swap/index.js'
import {
  applySwap,
  bruteForceSwapToPrice,
  buildConcentratedState,
  buildConstantProductState,
  buildStableSwapState,
  makeToken,
} from './testing.js'
import { getSqrtRatioAtTick } from './tickMath.js'

describe('buildConcentratedState', () => {
  it('aggregates positions into ticks and active liquidity', () => {
    const state = buildConcentratedState({
      positions: [
        { tickLower: -600, tickUpper: 600, liquidity: 100n },
        { tickLower: -60, tickUpper: 600, liquidity: 50n },
        { tickLower: 600, tickUpper: 1200, liquidity: 7n },
      ],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
      blockNumber: 42n,
      timestamp: 123,
    })
    expect(state.kind).toBe('concentrated')
    expect(state.liquidity).toBe(150n)
    expect(state.sqrtPriceX96).toBe(getSqrtRatioAtTick(0))
    expect(state.ticks).toEqual([
      { index: -600, liquidityNet: 100n, liquidityGross: 100n },
      { index: -60, liquidityNet: 50n, liquidityGross: 50n },
      { index: 600, liquidityNet: -143n, liquidityGross: 157n },
      { index: 1200, liquidityNet: -7n, liquidityGross: 7n },
    ])
    expect(state.tickLowerBound).toBe(-600)
    expect(state.tickUpperBound).toBe(1200)
    expect(state.blockNumber).toBe(42n)
    expect(state.timestamp).toBe(123)
    expect(state.feePips).toBe(3000)
    expect(state.tickSpacing).toBe(60)
  })

  it('accepts a sqrt price inside the tick and rejects one outside', () => {
    const inside = getSqrtRatioAtTick(0) + 1n
    expect(
      buildConcentratedState({
        positions: [],
        tick: 0,
        feePips: 1,
        tickSpacing: 1,
        sqrtPriceX96: inside,
      }).sqrtPriceX96,
    ).toBe(inside)
    expect(() =>
      buildConcentratedState({
        positions: [],
        tick: 0,
        feePips: 1,
        tickSpacing: 1,
        sqrtPriceX96: getSqrtRatioAtTick(1),
      }),
    ).toThrow(RangeError)
    expect(() =>
      buildConcentratedState({
        positions: [{ tickLower: 10, tickUpper: 10, liquidity: 1n }],
        tick: 0,
        feePips: 1,
        tickSpacing: 1,
      }),
    ).toThrow(RangeError)
  })

  it('bounds can be overridden', () => {
    const state = buildConcentratedState({
      positions: [{ tickLower: -600, tickUpper: 600, liquidity: 100n }],
      tick: 0,
      feePips: 1,
      tickSpacing: 1,
      tickLowerBound: -100,
      tickUpperBound: 100,
    })
    expect(state.tickLowerBound).toBe(-100)
    expect(state.tickUpperBound).toBe(100)
  })
})

describe('applySwap', () => {
  it('updates reserves net of fees for reserve pools', () => {
    const cp = buildConstantProductState(1_000_000n, 2_000_000n, 3000)
    const r = simulateSwapExactIn(cp, 'zeroForOne', 1000n)
    const next = applySwap(cp, r)
    if (next.kind !== 'constant-product') throw new Error('kind')
    expect(next.reserve0).toBe(1_000_997n)
    expect(next.reserve1).toBe(2_000_000n - r.amountOut)
    const st = buildStableSwapState(10n ** 24n, 10n ** 24n, 18, 18, 500)
    const rs = simulateSwapExactIn(st, 'oneForZero', 10n ** 18n)
    const nextSt = applySwap(st, rs)
    if (nextSt.kind !== 'stable-swap') throw new Error('kind')
    expect(nextSt.reserve1).toBe(10n ** 24n + 10n ** 18n - rs.feePaid)
    expect(nextSt.reserve0).toBe(10n ** 24n - rs.amountOut)
  })

  it('updates price, tick and liquidity for concentrated pools', () => {
    const state = buildConcentratedState({
      positions: [
        { tickLower: -600, tickUpper: 600, liquidity: 10n ** 21n },
        { tickLower: 60, tickUpper: 120, liquidity: 10n ** 21n },
      ],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const r = simulateSwapExactIn(state, 'oneForZero', 5n * 10n ** 18n)
    const next = applySwap(state, r)
    if (next.kind !== 'concentrated') throw new Error('kind')
    expect(next.sqrtPriceX96).toBe(r.sqrtPriceAfterX96)
    expect(next.tick).toBe(r.tickAfter)
    expect(next.tick).toBeGreaterThanOrEqual(60)
    expect(next.liquidity).toBe(next.tick < 120 ? 2n * 10n ** 21n : 10n ** 21n)
  })
})

describe('bruteForceSwapToPrice', () => {
  it('rejects a non-positive step, a step eaten by the fee and too many steps', () => {
    const cp = buildConstantProductState(10n ** 24n, 10n ** 24n, 3000)
    expect(() => bruteForceSwapToPrice(cp, 1.01, 0n)).toThrow(RangeError)
    expect(() => bruteForceSwapToPrice(cp, 1.01, 1000n, undefined, 3)).toThrow(/exceeded/)
    const cl = buildConcentratedState({
      positions: [{ tickLower: -600, tickUpper: 600, liquidity: 10n ** 21n }],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    expect(() => bruteForceSwapToPrice(cl, 1.01, 1n, { decimals0: 18, decimals1: 18 })).toThrow(
      /fee/,
    )
  })

  it('reports exhaustion', () => {
    const narrow = buildConcentratedState({
      positions: [{ tickLower: -60, tickUpper: 60, liquidity: 10n ** 18n }],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const r = bruteForceSwapToPrice(narrow, 2, 10n ** 17n, { decimals0: 18, decimals1: 18 })
    expect(r.complete).toBe(false)
    expect(r.direction).toBe('oneForZero')
  })
})

describe('makeToken', () => {
  it('derives a stable fake address from the symbol', () => {
    const t = makeToken('USDC', 6)
    expect(t.decimals).toBe(6)
    expect(t.address).toMatch(/^0x[0-9a-f]{40}$/)
    expect(makeToken('USDC', 6).address).toBe(t.address)
    expect(makeToken('WETH', 18).address).not.toBe(t.address)
    expect(makeToken('X', 1, '0x1234').address).toBe('0x1234')
  })
})
