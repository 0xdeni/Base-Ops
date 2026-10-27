/**
 * Concentrated-liquidity swap walk with Uniswap v3 semantics (UniswapV3Pool.swap, exact input).
 * Every step runs with the swap fee of the walk's direction: the LP fee, combined with the
 * protocol fee on Uniswap v4 (./protocolFee.ts).
 *
 * Each step targets what `TickBitmap.nextInitializedTickWithinOneWord` would return: the next
 * initialised tick, but never beyond the edge of the current 256-slot bitmap word
 * (256 × tickSpacing ticks). Word edges are extra, uninitialised stops; the contract runs
 * `computeSwapStep` again from there, and because every step rounds on its own the walk must stop
 * at exactly the same places to match on-chain amounts to the wei.
 *
 * Differences from the contract are only about what is *known*: the tick list covers
 * [tickLowerBound, tickUpperBound] and nothing beyond, so the walk never extrapolates. The known
 * price interval is [ratio(tickLowerBound), ratio(tickUpperBound + 1)); if the price would have to
 * leave it, the walk stops with `complete = false`.
 */

import { clampBigint, maxBigint, minBigint, PIPS } from '../math.js'
import { computeSwapStep } from '../sqrtPriceMath.js'
import {
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
} from '../tickMath.js'
import type { ConcentratedState, SwapDirection, SwapResult, TickData } from '../types.js'
import { swapFeePips } from './protocolFee.js'

export interface ConcentratedSwapResult extends SwapResult {
  sqrtPriceAfterX96: bigint
  tickAfter: number
  /** Active liquidity once the walk stopped. */
  liquidityAfter: bigint
  /** Initialized ticks crossed during the walk. */
  ticksCrossed: number
  /** True when the walk stopped because the next tick lies outside the known bounds. */
  boundHit: boolean
}

/** Largest int256-ish amount: used as "unbounded" input for swap-to-price walks. */
const UNBOUNDED_AMOUNT = (1n << 255n) - 1n

interface Bounds {
  lower: number
  upper: number
}

function effectiveBounds(state: ConcentratedState): Bounds {
  const lower = Math.max(state.tickLowerBound, MIN_TICK)
  const upper = Math.min(state.tickUpperBound, MAX_TICK)
  if (lower > upper)
    throw new RangeError(`invalid tick bounds [${state.tickLowerBound}, ${state.tickUpperBound}]`)
  return { lower, upper }
}

/** Initialized ticks inside the known bounds, sorted ascending (defensive copy). */
export function knownTicks(state: ConcentratedState): TickData[] {
  const { lower, upper } = effectiveBounds(state)
  return state.ticks
    .filter((t) => t.index >= lower && t.index <= upper)
    .sort((a, b) => a.index - b.index)
}

/** Largest known tick with index ≤ tick, by binary search over a sorted list. */
function tickAtOrBelow(ticks: readonly TickData[], tick: number): TickData | undefined {
  let lo = 0
  let hi = ticks.length - 1
  let found: TickData | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = ticks[mid]
    if (t === undefined) break
    if (t.index <= tick) {
      found = t
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** Smallest known tick with index > tick, by binary search over a sorted list. */
function tickAbove(ticks: readonly TickData[], tick: number): TickData | undefined {
  let lo = 0
  let hi = ticks.length - 1
  let found: TickData | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = ticks[mid]
    if (t === undefined) break
    if (t.index > tick) {
      found = t
      hi = mid - 1
    } else lo = mid + 1
  }
  return found
}

/** Ticks per tick-bitmap word (one uint256 of the contract's `tickBitmap`). */
const WORD_SLOTS = 256

function walk(
  state: ConcentratedState,
  zeroForOne: boolean,
  amountSpecified: bigint,
  sqrtPriceLimitX96: bigint,
  mode: 'exactIn' | 'toPrice',
): ConcentratedSwapResult {
  const { lower, upper } = effectiveBounds(state)
  const ticks = knownTicks(state)
  const spacing = state.tickSpacing
  if (!Number.isInteger(spacing) || spacing <= 0)
    throw new RangeError(`swap: invalid tickSpacing ${spacing}`)
  let limit = clampBigint(sqrtPriceLimitX96, MIN_SQRT_RATIO + 1n, MAX_SQRT_RATIO - 1n)
  // A limit on the wrong side (only possible at the extreme ticks) means nothing can move.
  if (zeroForOne ? limit > state.sqrtPriceX96 : limit < state.sqrtPriceX96)
    limit = state.sqrtPriceX96

  let sqrtPrice = state.sqrtPriceX96
  let tick = state.tick
  let liquidity = state.liquidity
  let remaining = amountSpecified
  let amountIn = 0n
  let amountOut = 0n
  let feePaid = 0n
  let ticksCrossed = 0
  let boundHit = false
  const direction: SwapDirection = zeroForOne ? 'zeroForOne' : 'oneForZero'

  // Uniswap v4 charges the LP fee combined with the direction's protocol fee (./protocolFee.ts).
  const feePips = swapFeePips(state, direction)
  // A 100 % fee (Uniswap v4's MAX_LP_FEE) turns every input into fee without moving the price, so
  // no finite input reaches a different target: report no usable depth instead of consuming the
  // "unbounded" probe amount.
  if (mode === 'toPrice' && BigInt(feePips) === PIPS && sqrtPrice !== limit) {
    return {
      direction,
      amountIn: 0n,
      amountOut: 0n,
      feePaid: 0n,
      complete: false,
      sqrtPriceAfterX96: sqrtPrice,
      tickAfter: tick,
      liquidityAfter: liquidity,
      ticksCrossed: 0,
      boundHit: false,
    }
  }

  while (remaining > 0n && sqrtPrice !== limit) {
    // TickBitmap.nextInitializedTickWithinOneWord: `compressed` is the tick rounded towards
    // negative infinity to a multiple of the spacing; a word holds 256 compressed slots.
    const compressed = Math.floor(tick / spacing)
    let tickNext: number
    let crossing: TickData | undefined
    if (zeroForOne) {
      if (tick < lower) {
        boundHit = true
        break
      }
      // Searching downwards stops at the first slot of the current word.
      const wordStart = ((compressed >> 8) << 8) * spacing
      const candidate = tickAtOrBelow(ticks, tick)
      tickNext = Math.max(wordStart, candidate ? candidate.index : lower)
      crossing = candidate && candidate.index === tickNext ? candidate : undefined
    } else {
      if (tick > upper) {
        boundHit = true
        break
      }
      // Searching upwards starts from the next slot and stops at the last slot of its word.
      const wordEnd = ((((compressed + 1) >> 8) + 1) * WORD_SLOTS - 1) * spacing
      const candidate = tickAbove(ticks, tick)
      tickNext = Math.min(wordEnd, candidate ? candidate.index : upper + 1, MAX_TICK)
      crossing = candidate && candidate.index === tickNext ? candidate : undefined
    }
    const sqrtPriceStart = sqrtPrice
    const sqrtPriceNext = getSqrtRatioAtTick(tickNext)
    const target = zeroForOne ? maxBigint(sqrtPriceNext, limit) : minBigint(sqrtPriceNext, limit)
    if (zeroForOne ? target > sqrtPrice : target < sqrtPrice)
      throw new RangeError(`swap: tick ${tick} is inconsistent with sqrtPriceX96 ${sqrtPrice}`)
    const step = computeSwapStep(sqrtPrice, target, liquidity, remaining, feePips)
    sqrtPrice = step.sqrtRatioNextX96
    const consumed = step.amountIn + step.feeAmount
    remaining -= consumed
    amountIn += consumed
    amountOut += step.amountOut
    feePaid += step.feeAmount

    if (sqrtPrice === sqrtPriceNext) {
      if (crossing) {
        liquidity = zeroForOne
          ? liquidity - crossing.liquidityNet
          : liquidity + crossing.liquidityNet
        if (liquidity < 0n)
          throw new RangeError(`swap: liquidity underflow crossing tick ${crossing.index}`)
        ticksCrossed++
      }
      // Moving down and landing exactly on a tick puts the pool in the range below it.
      tick = zeroForOne ? tickNext - 1 : tickNext
    } else if (sqrtPrice !== sqrtPriceStart) {
      tick = getTickAtSqrtRatio(sqrtPrice)
    }
  }

  const complete = mode === 'exactIn' ? remaining === 0n : sqrtPrice === limit
  return {
    direction,
    amountIn,
    amountOut,
    feePaid,
    complete,
    sqrtPriceAfterX96: sqrtPrice,
    tickAfter: tick,
    liquidityAfter: liquidity,
    ticksCrossed,
    boundHit,
  }
}

/** Exact-input swap on a concentrated pool. `amountIn` includes the LP fee. */
export function simulateConcentratedExactIn(
  state: ConcentratedState,
  direction: SwapDirection,
  amountIn: bigint,
): ConcentratedSwapResult {
  if (amountIn < 0n) throw new RangeError('simulateConcentratedExactIn: negative amountIn')
  const zeroForOne = direction === 'zeroForOne'
  const limit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n
  return walk(state, zeroForOne, amountIn, limit, 'exactIn')
}

/**
 * Swap until the pool's sqrt price reaches `targetSqrtPriceX96` (sqrtPriceLimit semantics).
 * Direction is implied by the target side; `complete` is true when the target was reached.
 */
export function simulateConcentratedToSqrtPrice(
  state: ConcentratedState,
  targetSqrtPriceX96: bigint,
): ConcentratedSwapResult {
  const zeroForOne = targetSqrtPriceX96 < state.sqrtPriceX96
  return walk(state, zeroForOne, UNBOUNDED_AMOUNT, targetSqrtPriceX96, 'toPrice')
}

/**
 * Active liquidity the pool would have at `tick`, derived from the current liquidity and the
 * liquidityNet of every initialized tick between here and there (all ticks in the state, not
 * only those inside the bounds).
 */
export function liquidityAtTick(state: ConcentratedState, tick: number): bigint {
  let liquidity = state.liquidity
  if (tick > state.tick) {
    for (const t of state.ticks) {
      if (t.index > state.tick && t.index <= tick) liquidity += t.liquidityNet
    }
  } else if (tick < state.tick) {
    for (const t of state.ticks) {
      if (t.index > tick && t.index <= state.tick) liquidity -= t.liquidityNet
    }
  }
  return liquidity
}
