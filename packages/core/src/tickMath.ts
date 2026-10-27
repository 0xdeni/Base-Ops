/**
 * Exact port of Uniswap v3's TickMath plus human price conversions.
 *
 * `getSqrtRatioAtTick` reproduces the contract bit for bit (per-bit magic constants in Q128.128,
 * inversion for positive ticks, round-up shift to Q64.96). `getTickAtSqrtRatio` is its exact
 * inverse: the greatest tick whose ratio is ≤ the given sqrt price.
 */

import { MAX_UINT256, numberToFraction, pow10, Q192, sqrtBigint } from './math.js'

export const MIN_TICK = -887272
export const MAX_TICK = 887272
/** getSqrtRatioAtTick(MIN_TICK). */
export const MIN_SQRT_RATIO = 4295128739n
/** getSqrtRatioAtTick(MAX_TICK). Prices are always strictly below this. */
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n

/** Q128.128 factors: MAGIC[i] = 2^128 / sqrt(1.0001)^(2^i), used for bit i of |tick|. */
const MAGIC: readonly bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
]

const LOG_SQRT_10001 = 255738958999603826347141n
const TICK_LOW_OFFSET = 3402992956809132418596140100660247210n
const TICK_HIGH_OFFSET = 291339464771989622907027621153398088495n

/**
 * sqrt(1.0001^tick) * 2^96 as the Uniswap v3 contract computes it.
 * Throws for ticks outside [MIN_TICK, MAX_TICK].
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK)
    throw new RangeError(`getSqrtRatioAtTick: tick out of range: ${tick}`)
  const absTick = tick < 0 ? -tick : tick
  let ratio = (absTick & 1) !== 0 ? (MAGIC[0] as bigint) : 1n << 128n
  for (let bit = 1; bit < MAGIC.length; bit++) {
    if ((absTick & (1 << bit)) !== 0) ratio = (ratio * (MAGIC[bit] as bigint)) >> 128n
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio
  // Q128.128 → Q64.96, rounding up so that getTickAtSqrtRatio(getSqrtRatioAtTick(t)) === t.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

/**
 * Greatest tick t such that getSqrtRatioAtTick(t) ≤ sqrtPriceX96.
 * Requires MIN_SQRT_RATIO ≤ sqrtPriceX96 < MAX_SQRT_RATIO like the contract.
 */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO)
    throw new RangeError(`getTickAtSqrtRatio: sqrt price out of range: ${sqrtPriceX96}`)
  const ratio = sqrtPriceX96 << 32n
  const msb = ratio.toString(2).length - 1
  let r = msb >= 128 ? ratio >> BigInt(msb - 127) : ratio << BigInt(127 - msb)
  let log2 = BigInt(msb - 128) << 64n
  for (let shift = 63; shift >= 50; shift--) {
    r = (r * r) >> 127n
    const f = r >> 128n
    log2 += f << BigInt(shift)
    r >>= f
  }
  const logSqrt10001 = log2 * LOG_SQRT_10001
  const tickLow = Number((logSqrt10001 - TICK_LOW_OFFSET) >> 128n)
  const tickHi = Number((logSqrt10001 + TICK_HIGH_OFFSET) >> 128n)
  if (tickLow === tickHi) return tickLow
  return getSqrtRatioAtTick(tickHi) <= sqrtPriceX96 ? tickHi : tickLow
}

/**
 * Human price (token1 per token0, decimal-adjusted) from a Q64.96 sqrt price:
 * `(sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)`.
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96
  return ratio * ratio * 10 ** (decimals0 - decimals1)
}

/**
 * Inverse of `sqrtPriceX96ToPrice`: floor(sqrt(price * 10^(decimals1 - decimals0)) * 2^96),
 * computed exactly in bigint from the double's rational value. Throws for non-positive or
 * non-finite prices. The result is not clamped to [MIN_SQRT_RATIO, MAX_SQRT_RATIO].
 */
export function priceToSqrtPriceX96(price: number, decimals0: number, decimals1: number): bigint {
  if (!(price > 0) || !Number.isFinite(price))
    throw new RangeError(`priceToSqrtPriceX96: invalid price ${price}`)
  const frac = numberToFraction(price)
  let num = frac.num
  let den = frac.den
  const shift = decimals1 - decimals0
  if (shift >= 0) num *= pow10(shift)
  else den *= pow10(-shift)
  return sqrtBigint((num * Q192) / den)
}

/** Clamp a tick into the valid range. */
export function clampTick(tick: number): number {
  return Math.min(Math.max(tick, MIN_TICK), MAX_TICK)
}
