/**
 * Exact port of Uniswap v3's SqrtPriceMath and SwapMath.computeSwapStep (exact-input branch),
 * including every rounding direction the contracts use so simulated amounts match on-chain
 * results to the wei.
 */

import { divRoundingUp, MAX_UINT256, mulDiv, mulDivRoundingUp, PIPS, Q96 } from './math.js'

/**
 * Amount of token0 between two sqrt prices for liquidity L:
 * `L * 2^96 * (√Pb − √Pa) / (√Pa · √Pb)`, rounded up or down.
 */
export function getAmount0Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [lower, upper] =
    sqrtRatioAX96 > sqrtRatioBX96 ? [sqrtRatioBX96, sqrtRatioAX96] : [sqrtRatioAX96, sqrtRatioBX96]
  if (lower <= 0n) throw new RangeError('getAmount0Delta: sqrt ratio must be positive')
  const numerator1 = liquidity << 96n
  const numerator2 = upper - lower
  return roundUp
    ? divRoundingUp(mulDivRoundingUp(numerator1, numerator2, upper), lower)
    : mulDiv(numerator1, numerator2, upper) / lower
}

/**
 * Amount of token1 between two sqrt prices for liquidity L: `L * (√Pb − √Pa) / 2^96`,
 * rounded up or down.
 */
export function getAmount1Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [lower, upper] =
    sqrtRatioAX96 > sqrtRatioBX96 ? [sqrtRatioBX96, sqrtRatioAX96] : [sqrtRatioAX96, sqrtRatioBX96]
  return roundUp
    ? mulDivRoundingUp(liquidity, upper - lower, Q96)
    : mulDiv(liquidity, upper - lower, Q96)
}

/** Next sqrt price after adding (add=true) or removing token0, rounded up like the contract. */
export function getNextSqrtPriceFromAmount0RoundingUp(
  sqrtPX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (amount === 0n) return sqrtPX96
  const numerator1 = liquidity << 96n
  const product = amount * sqrtPX96
  if (add) {
    if (product <= MAX_UINT256) {
      const denominator = numerator1 + product
      if (denominator <= MAX_UINT256) return mulDivRoundingUp(numerator1, sqrtPX96, denominator)
    }
    // Contract fallback path when amount * sqrtP would overflow uint256.
    return divRoundingUp(numerator1, numerator1 / sqrtPX96 + amount)
  }
  if (product > MAX_UINT256 || numerator1 <= product)
    throw new RangeError('getNextSqrtPriceFromAmount0RoundingUp: insufficient liquidity')
  return mulDivRoundingUp(numerator1, sqrtPX96, numerator1 - product)
}

/** Next sqrt price after adding (add=true) or removing token1, rounded down like the contract. */
export function getNextSqrtPriceFromAmount1RoundingDown(
  sqrtPX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (add) {
    // Both contract branches (shift vs mulDiv) are the same exact value in unbounded integers.
    const quotient = (amount << 96n) / liquidity
    return sqrtPX96 + quotient
  }
  const quotient = divRoundingUp(amount << 96n, liquidity)
  if (sqrtPX96 <= quotient)
    throw new RangeError('getNextSqrtPriceFromAmount1RoundingDown: insufficient liquidity')
  return sqrtPX96 - quotient
}

/** Next sqrt price given an input amount (after fees) in the swap direction. */
export function getNextSqrtPriceFromInput(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  if (sqrtPX96 <= 0n) throw new RangeError('getNextSqrtPriceFromInput: sqrt price must be > 0')
  if (liquidity <= 0n) throw new RangeError('getNextSqrtPriceFromInput: liquidity must be > 0')
  return zeroForOne
    ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountIn, true)
    : getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountIn, true)
}

/** Next sqrt price given an output amount in the swap direction. */
export function getNextSqrtPriceFromOutput(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountOut: bigint,
  zeroForOne: boolean,
): bigint {
  if (sqrtPX96 <= 0n) throw new RangeError('getNextSqrtPriceFromOutput: sqrt price must be > 0')
  if (liquidity <= 0n) throw new RangeError('getNextSqrtPriceFromOutput: liquidity must be > 0')
  return zeroForOne
    ? getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountOut, false)
    : getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountOut, false)
}

export interface SwapStep {
  sqrtRatioNextX96: bigint
  /** Input consumed by the price move, fee excluded. */
  amountIn: bigint
  amountOut: bigint
  feeAmount: bigint
}

/**
 * One exact-input step within a single liquidity range (Uniswap v3 SwapMath.computeSwapStep).
 *
 * - The fee is taken from `amountRemaining` first: `amountRemainingLessFee = amountRemaining * (1e6 − fee) / 1e6`.
 * - If the step reaches `sqrtRatioTargetX96` the fee is `ceil(amountIn * fee / (1e6 − fee))`;
 *   otherwise the whole remainder of `amountRemaining` beyond `amountIn` is the fee.
 * - `feePips` may be anything in [0, 1e6]. A 100 % fee (Uniswap v4's `MAX_LP_FEE`) is handled
 *   like v4's SwapMath: the target is only reached when `amountIn` is 0 (zero liquidity or no
 *   price move) and the fee is then `amountIn`; otherwise the whole input is fee and the price
 *   does not move.
 */
export function computeSwapStep(
  sqrtRatioCurrentX96: bigint,
  sqrtRatioTargetX96: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  feePips: number,
): SwapStep {
  if (amountRemaining < 0n) throw new RangeError('computeSwapStep: exact input only')
  const fee = BigInt(feePips)
  if (fee < 0n || fee > PIPS) throw new RangeError(`computeSwapStep: invalid fee ${feePips}`)
  const zeroForOne = sqrtRatioCurrentX96 >= sqrtRatioTargetX96
  const amountRemainingLessFee = mulDiv(amountRemaining, PIPS - fee, PIPS)
  let amountIn = zeroForOne
    ? getAmount0Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, true)
    : getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, true)
  const sqrtRatioNextX96 =
    amountRemainingLessFee >= amountIn
      ? sqrtRatioTargetX96
      : getNextSqrtPriceFromInput(
          sqrtRatioCurrentX96,
          liquidity,
          amountRemainingLessFee,
          zeroForOne,
        )
  const reachedTarget = sqrtRatioTargetX96 === sqrtRatioNextX96
  let amountOut: bigint
  if (zeroForOne) {
    if (!reachedTarget)
      amountIn = getAmount0Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, true)
    amountOut = getAmount1Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, false)
  } else {
    if (!reachedTarget)
      amountIn = getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, true)
    amountOut = getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, false)
  }
  let feeAmount: bigint
  if (!reachedTarget) feeAmount = amountRemaining - amountIn
  // With a 100 % fee the target is reached only when amountIn is 0 (v4: feeAmount = amountIn).
  else if (fee === PIPS) feeAmount = amountIn
  else feeAmount = mulDivRoundingUp(amountIn, fee, PIPS - fee)
  return { sqrtRatioNextX96, amountIn, amountOut, feeAmount }
}
