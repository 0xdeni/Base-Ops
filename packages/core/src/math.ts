/**
 * Integer and numeric helpers shared by the core math modules.
 *
 * Every bigint helper is exact. The only places that touch `number` are the explicitly
 * human-facing conversions (`rawToHuman`, `numberToFraction`, percentiles), which are the last
 * step before a value is shown to a person, never an intermediate step of amount arithmetic.
 */

export const Q32 = 1n << 32n
export const Q96 = 1n << 96n
export const Q128 = 1n << 128n
export const Q192 = 1n << 192n
export const MAX_UINT256 = (1n << 256n) - 1n
export const MAX_UINT160 = (1n << 160n) - 1n
/** Fee denominator: fees are expressed in pips (1e-6). */
export const PIPS = 1_000_000n
export const WAD = 10n ** 18n

/** floor(a * b / denominator) for non-negative inputs. */
export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('mulDiv: division by zero')
  return (a * b) / denominator
}

/** ceil(a * b / denominator) for non-negative inputs. */
export function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('mulDivRoundingUp: division by zero')
  const product = a * b
  const quotient = product / denominator
  return product % denominator === 0n ? quotient : quotient + 1n
}

/** ceil(a / denominator) for non-negative inputs. */
export function divRoundingUp(a: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('divRoundingUp: division by zero')
  const quotient = a / denominator
  return a % denominator === 0n ? quotient : quotient + 1n
}

/** Number of bits needed to represent `x` (0 for 0). */
export function bitLength(x: bigint): number {
  if (x < 0n) throw new RangeError('bitLength: negative input')
  return x === 0n ? 0 : x.toString(2).length
}

/** floor(sqrt(n)) by Newton iteration, exact for any non-negative bigint. */
export function sqrtBigint(n: bigint): bigint {
  if (n < 0n) throw new RangeError('sqrtBigint: negative input')
  if (n < 2n) return n
  // Start above the root so the iteration decreases monotonically to floor(sqrt(n)).
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2))
  for (;;) {
    const y = (x + n / x) >> 1n
    if (y >= x) return x
    x = y
  }
}

export function absBigint(x: bigint): bigint {
  return x < 0n ? -x : x
}

export function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

export function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

export function clampBigint(x: bigint, lo: bigint, hi: bigint): bigint {
  return x < lo ? lo : x > hi ? hi : x
}

/** Clamps `x` into [lo, hi]. NaN propagates. */
export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return Number.NaN
  return Math.min(Math.max(x, lo), hi)
}

/**
 * Percentile with linear interpolation between order statistics (the same definition as
 * numpy's default): rank = p/100 * (n - 1). Returns NaN for an empty input.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile: p out of range: ${p}`)
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const vLo = sorted[lo]
  const vHi = sorted[hi]
  if (vLo === undefined || vHi === undefined) return Number.NaN
  if (lo === hi) return vLo
  return vLo + (vHi - vLo) * (rank - lo)
}

/** Median = 50th percentile (interpolated for even counts). NaN for an empty input. */
export function median(values: readonly number[]): number {
  return percentile(values, 50)
}

export interface Fraction {
  num: bigint
  den: bigint
}

/**
 * Exact rational decomposition of a finite double: returns num/den === x with den a power of two.
 * Lets price targets given as `number` be used in exact bigint arithmetic without going through
 * `Number` again.
 */
export function numberToFraction(x: number): Fraction {
  if (!Number.isFinite(x)) throw new RangeError(`numberToFraction: not finite: ${x}`)
  if (x === 0) return { num: 0n, den: 1n }
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const hi = view.getUint32(0)
  const lo = view.getUint32(4)
  const negative = hi >>> 31 === 1
  const exponent = (hi >>> 20) & 0x7ff
  const mantissaBits = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let mantissa: bigint
  let exp2: number
  if (exponent === 0) {
    mantissa = mantissaBits
    exp2 = -1074
  } else {
    mantissa = mantissaBits | (1n << 52n)
    exp2 = exponent - 1075
  }
  let num: bigint
  let den: bigint
  if (exp2 >= 0) {
    num = mantissa << BigInt(exp2)
    den = 1n
  } else {
    num = mantissa
    den = 1n << BigInt(-exp2)
    while ((num & 1n) === 0n && den > 1n) {
      num >>= 1n
      den >>= 1n
    }
  }
  return { num: negative ? -num : num, den }
}

/** 10^n as bigint (n ≥ 0). */
export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`pow10: invalid exponent ${n}`)
  return 10n ** BigInt(n)
}

/** Raw token amount → human units. Human-facing: this is the one sanctioned bigint→number step. */
export function rawToHuman(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals
}

/**
 * Human units → raw token amount, rounded to the nearest unit (half away from zero) from the
 * double's exact rational value, so `humanToRaw(0.000001, 6)` is 1n. Throws for non-finite input.
 */
export function humanToRaw(amount: number, decimals: number): bigint {
  const { num, den } = numberToFraction(amount)
  const scaled = num * pow10(decimals)
  const twice = 2n * scaled + (scaled < 0n ? -den : den)
  return twice / (2n * den)
}
