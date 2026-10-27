/**
 * Aerodrome v2 stable pool math: invariant k = x³y + xy³ on 1e18-normalised reserves.
 *
 * `_k`, `_f`, `_d`, `_get_y` and `_getAmountOut` are ports of Pool.sol, including its rounding and
 * its quirks (the `_k(x0, y + 1)` convergence check re-applies the decimals normalisation exactly
 * like the contract does). Newton runs for at most 255 iterations and converges to 1 wei of
 * normalised units.
 */

import { type Fraction, numberToFraction, pow10, WAD } from '../math.js'
import type { StableSwapState, SwapDirection, SwapResult } from '../types.js'
import { amountInAfterFee, feeOnAmountIn } from './fees.js'

/**
 * The contract's `_get_y` would revert on these inputs: Newton did not converge within 255
 * iterations ("!y"), or the reserves are so small that `_d` floors to 0 (division by zero, the
 * state a drained pool is left in). The simulators map it to `complete: false`.
 */
export class StableSwapNonConvergence extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StableSwapNonConvergence'
  }
}

/** Pool.sol `_k` for a stable pool: x and y are raw reserves, scales are 10^decimals. */
export function _k(x: bigint, y: bigint, scale0: bigint, scale1: bigint): bigint {
  const _x = (x * WAD) / scale0
  const _y = (y * WAD) / scale1
  const _a = (_x * _y) / WAD
  const _b = (_x * _x) / WAD + (_y * _y) / WAD
  return (_a * _b) / WAD
}

/** Pool.sol `_f`: the invariant on already-normalised reserves. */
export function _f(x0: bigint, y: bigint): bigint {
  const _a = (x0 * y) / WAD
  const _b = (x0 * x0) / WAD + (y * y) / WAD
  return (_a * _b) / WAD
}

/** Pool.sol `_d`: ∂f/∂y = 3·x0·y² + x0³ (normalised). */
export function _d(x0: bigint, y: bigint): bigint {
  return (3n * x0 * ((y * y) / WAD)) / WAD + (((x0 * x0) / WAD) * x0) / WAD
}

/**
 * Pool.sol `_get_y`: Newton iteration for y such that f(x0, y) ≥ xy, starting from `y`.
 * Throws `StableSwapNonConvergence` where the contract reverts: no convergence within 255
 * iterations ("!y"), or `_d` = 0 (reserves below ~1e-6 tokens, a bare division by zero on-chain).
 */
export function _get_y(x0: bigint, xy: bigint, y: bigint, scale0: bigint, scale1: bigint): bigint {
  let yCur = y
  for (let i = 0; i < 255; i++) {
    const k = _f(x0, yCur)
    const d = _d(x0, yCur)
    if (d === 0n)
      throw new StableSwapNonConvergence(
        'stable swap: _d is zero (reserves too small for the invariant; the contract reverts)',
      )
    if (k < xy) {
      let dy = ((xy - k) * WAD) / d
      if (dy === 0n) {
        if (k === xy) return yCur
        if (_k(x0, yCur + 1n, scale0, scale1) > xy) return yCur + 1n
        dy = 1n
      }
      yCur += dy
    } else {
      let dy = ((k - xy) * WAD) / d
      if (dy === 0n) {
        if (k === xy || yCur === 0n || _f(x0, yCur - 1n) < xy) return yCur
        dy = 1n
      }
      yCur -= dy
    }
  }
  throw new StableSwapNonConvergence('stable swap: _get_y did not converge')
}

/** Pool.sol `_getAmountOut` for the stable branch: `amountIn` is already net of fees. */
export function _getAmountOut(
  netAmountIn: bigint,
  zeroForOne: boolean,
  reserve0: bigint,
  reserve1: bigint,
  scale0: bigint,
  scale1: bigint,
): bigint {
  if (netAmountIn <= 0n) return 0n
  const xy = _k(reserve0, reserve1, scale0, scale1)
  const r0 = (reserve0 * WAD) / scale0
  const r1 = (reserve1 * WAD) / scale1
  const [reserveA, reserveB] = zeroForOne ? [r0, r1] : [r1, r0]
  const amountInN = zeroForOne ? (netAmountIn * WAD) / scale0 : (netAmountIn * WAD) / scale1
  const yNew = _get_y(amountInN + reserveA, xy, reserveB, scale0, scale1)
  const y = yNew >= reserveB ? 0n : reserveB - yNew
  return (y * (zeroForOne ? scale1 : scale0)) / WAD
}

/** Pool.getAmountOut: fee removed from `amountIn`, then the invariant is solved. */
export function stableGetAmountOut(
  state: StableSwapState,
  direction: SwapDirection,
  amountIn: bigint,
): bigint {
  return _getAmountOut(
    amountInAfterFee(amountIn, state.feePips),
    direction === 'zeroForOne',
    state.reserve0,
    state.reserve1,
    pow10(state.decimals0),
    pow10(state.decimals1),
  )
}

/** Normalised reserves (1e18 units) of a stable pool. */
export function normalisedReserves(state: StableSwapState): { x: bigint; y: bigint } {
  return {
    x: (state.reserve0 * WAD) / pow10(state.decimals0),
    y: (state.reserve1 * WAD) / pow10(state.decimals1),
  }
}

/**
 * Marginal price token1 per token0 of normalised reserves (x, y) as an exact fraction:
 * `dy/dx = (3x²y + y³) / (x³ + 3xy²)` (human, because both reserves are normalised).
 */
export function stableMarginalPriceFraction(x: bigint, y: bigint): Fraction {
  return { num: 3n * x * x * y + y * y * y, den: x * x * x + 3n * x * y * y }
}

/** Analytic marginal price token1 per token0 (human) of the pool. NaN for an empty pool. */
export function stableMarginalPrice(state: StableSwapState): number {
  const { x, y } = normalisedReserves(state)
  const { num, den } = stableMarginalPriceFraction(x, y)
  if (den === 0n) return Number.NaN
  return Number((num * WAD) / den) / 1e18
}

/**
 * Exact-input swap on a stable pool. `complete` is false for an empty pool and when the contract
 * would revert on the swap (reserves too small for its math, see `StableSwapNonConvergence`).
 */
export function simulateStableExactIn(
  state: StableSwapState,
  direction: SwapDirection,
  amountIn: bigint,
): SwapResult {
  if (amountIn < 0n) throw new RangeError('simulateStableExactIn: negative amountIn')
  if (state.reserve0 === 0n || state.reserve1 === 0n)
    return { direction, amountIn: 0n, amountOut: 0n, feePaid: 0n, complete: false }
  try {
    return {
      direction,
      amountIn,
      amountOut: stableGetAmountOut(state, direction, amountIn),
      feePaid: feeOnAmountIn(amountIn, state.feePips),
      complete: true,
    }
  } catch (error) {
    if (error instanceof StableSwapNonConvergence)
      return { direction, amountIn: 0n, amountOut: 0n, feePaid: 0n, complete: false }
    throw error
  }
}

const MAX_DOUBLINGS = 64

/**
 * Input needed to move the pool's marginal price to `targetPrice` (human, token1 per token0,
 * using the state's own decimals). Exact bisection on the gross amountIn against the analytic
 * marginal price `dy/dx` of the post-trade normalised reserves (the same price
 * `stableMarginalPrice` reports for the pool after the swap): the result is the smallest input
 * whose post-trade price passes the target, to 1 wei of the input token.
 *
 * `complete` is false for an empty pool, when the target is out of reach, and when the contract
 * would revert on the probe swaps (reserves too small for its math).
 */
export function simulateStableToPrice(state: StableSwapState, targetPrice: number): SwapResult {
  if (!(targetPrice > 0) || !Number.isFinite(targetPrice))
    throw new RangeError(`simulateStableToPrice: invalid target ${targetPrice}`)
  const mid = stableMarginalPrice(state)
  const direction: SwapDirection = targetPrice > mid ? 'oneForZero' : 'zeroForOne'
  const incomplete: SwapResult = {
    direction,
    amountIn: 0n,
    amountOut: 0n,
    feePaid: 0n,
    complete: false,
  }
  if (state.reserve0 === 0n || state.reserve1 === 0n) return incomplete
  const zeroForOne = direction === 'zeroForOne'
  const scale0 = pow10(state.decimals0)
  const scale1 = pow10(state.decimals1)
  const reserveIn = zeroForOne ? state.reserve0 : state.reserve1
  const { num: tNum, den: tDen } = numberToFraction(targetPrice)
  const out = (net: bigint): bigint =>
    _getAmountOut(net, zeroForOne, state.reserve0, state.reserve1, scale0, scale1)

  // Predicate: after a gross input `a`, has the marginal price of the post-trade reserves passed
  // the target? Monotone in `a` (the input reserve grows, the output reserve shrinks), so the
  // bisection below converges to the exact boundary.
  const passed = (a: bigint): boolean => {
    const net = amountInAfterFee(a, state.feePips)
    const amountOut = out(net)
    const reserve0 = zeroForOne ? state.reserve0 + net : state.reserve0 - amountOut
    const reserve1 = zeroForOne ? state.reserve1 - amountOut : state.reserve1 + net
    const { num, den } = stableMarginalPriceFraction(
      (reserve0 * WAD) / scale0,
      (reserve1 * WAD) / scale1,
    )
    // price = num / den vs target = tNum / tDen, compared exactly
    return zeroForOne ? num * tDen <= tNum * den : num * tDen >= tNum * den
  }

  const finish = (amountIn: bigint, complete: boolean): SwapResult => ({
    direction,
    amountIn,
    amountOut: out(amountInAfterFee(amountIn, state.feePips)),
    feePaid: feeOnAmountIn(amountIn, state.feePips),
    complete,
  })

  try {
    if (passed(0n)) return finish(0n, true)
    let lo = 0n
    let hi = reserveIn
    let doublings = 0
    while (!passed(hi)) {
      if (++doublings > MAX_DOUBLINGS) return finish(hi, false)
      lo = hi
      hi *= 2n
    }
    // Invariant: !passed(lo) && passed(hi). Ends with hi − lo = 1, i.e. hi is the exact answer;
    // at most bitLength(hi) iterations.
    while (hi - lo > 1n) {
      const midPoint = (lo + hi) >> 1n
      if (passed(midPoint)) hi = midPoint
      else lo = midPoint
    }
    return finish(hi, true)
  } catch (error) {
    // The contract would revert on the probe swap: the pool has no usable depth.
    if (error instanceof StableSwapNonConvergence) return incomplete
    throw error
  }
}
