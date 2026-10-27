/**
 * Fee helpers for the reserve-based (Aerodrome v2) pools.
 *
 * Aerodrome's `getAmountOut` removes `amountIn * feeBps / 10000` (floored) from the input before
 * solving the invariant; with fees stored in pips (bps × 100) that is `amountIn * feePips / 1e6`.
 * Fees leave the pool (they are sent to the PoolFees contract), so reserves only grow by the net.
 */

import { mulDivRoundingUp, PIPS } from '../math.js'

/** LP fee taken from `amountIn`, floored like Aerodrome's Pool.getAmountOut. */
export function feeOnAmountIn(amountIn: bigint, feePips: number): bigint {
  const fee = BigInt(feePips)
  if (fee < 0n || fee >= PIPS) throw new RangeError(`feeOnAmountIn: invalid fee ${feePips}`)
  return (amountIn * fee) / PIPS
}

/** Input that remains after the LP fee. */
export function amountInAfterFee(amountIn: bigint, feePips: number): bigint {
  return amountIn - feeOnAmountIn(amountIn, feePips)
}

/**
 * Smallest gross `amountIn` whose net (after `feeOnAmountIn`) is at least `netAmount`.
 * Exact: starts from ceil(net * 1e6 / (1e6 − fee)) and corrects by ±1 for flooring.
 */
export function grossUpForFee(netAmount: bigint, feePips: number): bigint {
  if (netAmount <= 0n) return 0n
  const fee = BigInt(feePips)
  if (fee < 0n || fee >= PIPS) throw new RangeError(`grossUpForFee: invalid fee ${feePips}`)
  let gross = mulDivRoundingUp(netAmount, PIPS, PIPS - fee)
  while (amountInAfterFee(gross, feePips) < netAmount) gross += 1n
  while (gross > 0n && amountInAfterFee(gross - 1n, feePips) >= netAmount) gross -= 1n
  return gross
}
