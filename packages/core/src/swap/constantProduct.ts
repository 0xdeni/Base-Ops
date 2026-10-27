/**
 * Constant-product (Aerodrome v2 volatile) swap math.
 *
 * `amountOut = reserveOut · net / (reserveIn + net)` with `net = amountIn − fee` (fee floored like
 * the contract). Fees leave the pool, so the post-swap marginal price is `k / (reserveIn + net)^2`,
 * which gives the closed-form depth: `net = reserveIn · (√ratio − 1)` where ratio is the price
 * move (> 1) in the orientation of the input token.
 */

import { divRoundingUp, numberToFraction, pow10, sqrtBigint } from '../math.js'
import type { ConstantProductState, SwapDirection, SwapResult } from '../types.js'
import { amountInAfterFee, feeOnAmountIn, grossUpForFee } from './fees.js'
import type { PriceDecimals } from './midPrice.js'

/** Output for a net (post-fee) input against the given reserves. */
export function constantProductAmountOut(
  reserveIn: bigint,
  reserveOut: bigint,
  netAmountIn: bigint,
): bigint {
  if (netAmountIn <= 0n || reserveIn + netAmountIn === 0n) return 0n
  return (netAmountIn * reserveOut) / (reserveIn + netAmountIn)
}

function reservesFor(
  state: ConstantProductState,
  direction: SwapDirection,
): { reserveIn: bigint; reserveOut: bigint } {
  return direction === 'zeroForOne'
    ? { reserveIn: state.reserve0, reserveOut: state.reserve1 }
    : { reserveIn: state.reserve1, reserveOut: state.reserve0 }
}

/** Exact-input swap. `complete` is false only for an empty pool. */
export function simulateConstantProductExactIn(
  state: ConstantProductState,
  direction: SwapDirection,
  amountIn: bigint,
): SwapResult {
  if (amountIn < 0n) throw new RangeError('simulateConstantProductExactIn: negative amountIn')
  const { reserveIn, reserveOut } = reservesFor(state, direction)
  const feePaid = feeOnAmountIn(amountIn, state.feePips)
  const net = amountIn - feePaid
  if (reserveIn === 0n || reserveOut === 0n)
    return { direction, amountIn: 0n, amountOut: 0n, feePaid: 0n, complete: false }
  return {
    direction,
    amountIn,
    amountOut: constantProductAmountOut(reserveIn, reserveOut, net),
    feePaid,
    complete: true,
  }
}

/**
 * Closed-form input needed to move the marginal price `reserve1/reserve0` (decimal-adjusted by
 * `decimals`) to `targetPrice`, then grossed up for the fee. Direction follows the target side.
 */
export function simulateConstantProductToPrice(
  state: ConstantProductState,
  targetPrice: number,
  decimals: PriceDecimals,
): SwapResult {
  if (!(targetPrice > 0) || !Number.isFinite(targetPrice))
    throw new RangeError(`simulateConstantProductToPrice: invalid target ${targetPrice}`)
  const { reserve0, reserve1 } = state
  const { num: tNum, den: tDen } = numberToFraction(targetPrice)
  const scale0 = pow10(decimals.decimals0)
  const scale1 = pow10(decimals.decimals1)
  // human price = reserve1 / reserve0 * 10^(d0 - d1)  ⇔  compare tNum*scale1*reserve0 vs tDen*scale0*reserve1
  const targetSide = tNum * scale1 * reserve0
  const currentSide = tDen * scale0 * reserve1
  const direction: SwapDirection = targetSide > currentSide ? 'oneForZero' : 'zeroForOne'
  if (reserve0 === 0n || reserve1 === 0n)
    return { direction, amountIn: 0n, amountOut: 0n, feePaid: 0n, complete: false }
  const { reserveIn, reserveOut } = reservesFor(state, direction)
  // ratio = target/current for oneForZero, current/target for zeroForOne (both ≥ 1).
  const [ratioNum, ratioDen] =
    direction === 'oneForZero' ? [targetSide, currentSide] : [currentSide, targetSide]
  // smallest n with (reserveIn + n)^2 · ratioDen ≥ reserveIn^2 · ratioNum: ceil of the square root
  const squared = divRoundingUp(reserveIn * reserveIn * ratioNum, ratioDen)
  let scaledReserve = sqrtBigint(squared)
  if (scaledReserve * scaledReserve < squared) scaledReserve += 1n
  const netNeeded = scaledReserve > reserveIn ? scaledReserve - reserveIn : 0n
  const amountIn = grossUpForFee(netNeeded, state.feePips)
  const net = amountInAfterFee(amountIn, state.feePips)
  return {
    direction,
    amountIn,
    amountOut: constantProductAmountOut(reserveIn, reserveOut, net),
    feePaid: amountIn - net,
    complete: true,
  }
}
