/**
 * LP concentration inside a ±band around mid.
 *
 * Range HHI: split the band into tick ranges between consecutive initialised ticks, weight each by
 * `L_range × (√Pupper − √Plower)` clipped to the band (≈ token1 value), `rangeHhi = Σ share²`,
 * `activeRangeShare` = share of the range holding the current tick.
 * Owner concentration: each position overlapping the band weighs `liquidity × clipped (√Pupper − √Plower)`,
 * aggregated by owner → top1 / top3 share, HHI, count of owners with positive weight, and the
 * coverage Σ owner weights / pool in-band weight. Positions of an excluded owner (a custodian such
 * as a Slipstream gauge, which holds staked NFTs for their depositors) are left out: uncovered.
 *
 * Both weightings use the band clipped to the pool's known ticks (`clipBandToKnownTicks`), so
 * nothing is extrapolated beyond the state. They are exported (`poolBandWeight`,
 * `positionsBandWeight`) so the market-maker attribution (mm/attribution.ts) shares them: for a
 * pool made of a set of positions, Σ over owners of `positionsBandWeight` over the clipped band
 * equals `poolBandWeight` exactly, and `computeConcentration` weighs owners with that same
 * clipped band.
 */

import { maxBigint, minBigint, numberToFraction, sqrtBigint, WAD } from '../math.js'
import { knownTicks } from '../swap/concentrated.js'
import {
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
} from '../tickMath.js'
import {
  CONCENTRATION_BAND_PCT,
  type ConcentratedState,
  type ConcentrationMetrics,
  type ConstantProductState,
  type OwnerConcentration,
  type Position,
  type StableSwapState,
} from '../types.js'

export interface SqrtBand {
  lower: bigint
  upper: bigint
}

/** √(mid·(1 ∓ band/100)) in Q64.96, clamped to the valid sqrt price range. */
export function bandSqrtBounds(sqrtPriceX96: bigint, bandPct: number): SqrtBand {
  if (!(bandPct > 0) || bandPct >= 100) throw new RangeError(`invalid bandPct ${bandPct}`)
  const square = sqrtPriceX96 * sqrtPriceX96
  const lo = numberToFraction(1 - bandPct / 100)
  const hi = numberToFraction(1 + bandPct / 100)
  const lower = sqrtBigint((square * lo.num) / lo.den)
  const upper = sqrtBigint((square * hi.num) / hi.den)
  return {
    lower: maxBigint(lower, MIN_SQRT_RATIO),
    upper: minBigint(upper, MAX_SQRT_RATIO - 1n),
  }
}

/**
 * `band` clipped to the pool's known price interval [√P(tickLowerBound), √P(tickUpperBound + 1)),
 * so that nothing is ever extrapolated beyond the ticks the state knows. The result is empty
 * (upper ≤ lower) when the band lies entirely outside the known interval.
 */
export function clipBandToKnownTicks(state: ConcentratedState, band: SqrtBand): SqrtBand {
  const lowerBound = Math.max(state.tickLowerBound, MIN_TICK)
  const upperBound = Math.min(state.tickUpperBound, MAX_TICK)
  const knownLower = getSqrtRatioAtTick(lowerBound)
  const knownUpper = getSqrtRatioAtTick(Math.min(upperBound + 1, MAX_TICK))
  return { lower: maxBigint(band.lower, knownLower), upper: minBigint(band.upper, knownUpper) }
}

/**
 * In-band weight of one position: `liquidity × clipped (√Pupper − √Plower)` (≈ its token1 value
 * inside the band). 0n when it does not overlap the band or has no liquidity.
 */
export function positionBandWeight(position: Position, band: SqrtBand): bigint {
  if (position.liquidity <= 0n || position.tickLower >= position.tickUpper) return 0n
  const lo = getSqrtRatioAtTick(Math.max(position.tickLower, MIN_TICK))
  const hi = getSqrtRatioAtTick(Math.min(position.tickUpper, MAX_TICK))
  const a = maxBigint(lo, band.lower)
  const b = minBigint(hi, band.upper)
  return b > a ? position.liquidity * (b - a) : 0n
}

/** Σ `positionBandWeight` over the positions. */
export function positionsBandWeight(positions: readonly Position[], band: SqrtBand): bigint {
  let total = 0n
  for (const p of positions) total += positionBandWeight(p, band)
  return total
}

function sumBigints(values: readonly bigint[]): bigint {
  return values.reduce((acc, w) => acc + w, 0n)
}

function shareOf(weight: bigint, total: bigint): number {
  return Number((weight * WAD) / total) / 1e18
}

function sumSquares(shares: readonly number[]): number {
  return shares.reduce((acc, s) => acc + s * s, 0)
}

interface RangeWeights {
  weights: bigint[]
  activeIndex: number
}

/**
 * Weight of every tick range inside the band (clipped to the known ticks): the ranges are split
 * at the initialised ticks strictly inside the band, each weighing `L_range × (√Pupper − √Plower)`.
 */
function rangeWeights(state: ConcentratedState, band: SqrtBand): RangeWeights {
  const ticks = knownTicks(state)
  const { lower, upper } = clipBandToKnownTicks(state, band)
  if (upper <= lower) return { weights: [], activeIndex: -1 }
  const tickLo = getTickAtSqrtRatio(lower)
  const tickHi = getTickAtSqrtRatio(upper)
  const inner = ticks.filter((t) => t.index > tickLo && t.index <= tickHi)
  const boundaries: bigint[] = [lower, ...inner.map((t) => getSqrtRatioAtTick(t.index)), upper]
  const activeIndex = inner.filter((t) => t.index <= state.tick).length
  const liquidity: bigint[] = new Array(boundaries.length - 1).fill(0n)
  liquidity[activeIndex] = state.liquidity
  for (let i = activeIndex + 1; i < liquidity.length; i++) {
    const prev = liquidity[i - 1] ?? 0n
    const crossed = inner[i - 1]
    liquidity[i] = prev + (crossed?.liquidityNet ?? 0n)
  }
  for (let i = activeIndex - 1; i >= 0; i--) {
    const next = liquidity[i + 1] ?? 0n
    const crossed = inner[i]
    liquidity[i] = next - (crossed?.liquidityNet ?? 0n)
  }
  const weights = liquidity.map((l, i) => {
    const a = boundaries[i] ?? 0n
    const b = boundaries[i + 1] ?? 0n
    const width = b > a ? b - a : 0n
    return (l > 0n ? l : 0n) * width
  })
  return { weights, activeIndex }
}

/**
 * The pool's whole in-band liquidity weight: Σ over the tick ranges inside the band (clipped to
 * the known ticks) of `L_range × (√Pupper − √Plower)`. For a pool made of positions this equals
 * `positionsBandWeight` of all of them.
 */
export function poolBandWeight(state: ConcentratedState, band: SqrtBand): bigint {
  return sumBigints(rangeWeights(state, band).weights)
}

/**
 * In-band weight per owner (lowercased); owners without positive weight and the `excluded` ones
 * are left out.
 */
function weightsByOwner(
  positions: readonly Position[],
  band: SqrtBand,
  excluded: ReadonlySet<string>,
): Map<string, bigint> {
  const byOwner = new Map<string, bigint>()
  for (const p of positions) {
    const owner = p.owner.toLowerCase()
    if (excluded.has(owner)) continue
    const weight = positionBandWeight(p, band)
    if (weight <= 0n) continue
    byOwner.set(owner, (byOwner.get(owner) ?? 0n) + weight)
  }
  return byOwner
}

/** Owner shares over the indexed owners; `coverage` against the pool's in-band weight. */
function ownerConcentration(
  positions: readonly Position[],
  band: SqrtBand,
  poolWeight: bigint,
  excluded: ReadonlySet<string>,
): OwnerConcentration {
  const weights = [...weightsByOwner(positions, band, excluded).values()].sort((x, y) =>
    x > y ? -1 : x < y ? 1 : 0,
  )
  const total = sumBigints(weights)
  if (total === 0n) return { count: 0, top1Share: 0, top3Share: 0, hhi: 0, coverage: 0 }
  const shares = weights.map((w) => shareOf(w, total))
  const top1Share = shares[0] ?? 0
  const top3Share = shares.slice(0, 3).reduce((acc, s) => acc + s, 0)
  return {
    count: shares.length,
    top1Share,
    top3Share: Math.min(top3Share, 1),
    hhi: sumSquares(shares),
    // Positions read at another block than the state can exceed the pool's weight: clamped.
    coverage: poolWeight > 0n ? Math.min(shareOf(total, poolWeight), 1) : 0,
  }
}

/**
 * Structural and ownership concentration for a concentrated pool. `positions === null` means
 * positions were not indexed (owners → null). With no in-band liquidity, `rangeHhi` is 1 and
 * `activeRangeShare` is 0. Positions owned by an address in `excludedOwners` (a custodian, e.g.
 * the pool's Slipstream gauge) are attributed to no owner and lower `owners.coverage`.
 */
export function computeConcentration(
  state: ConcentratedState,
  positions: Position[] | null,
  bandPct: number = CONCENTRATION_BAND_PCT,
  excludedOwners: readonly string[] = [],
): ConcentrationMetrics {
  const band = bandSqrtBounds(state.sqrtPriceX96, bandPct)
  const { weights, activeIndex } = rangeWeights(state, band)
  const total = sumBigints(weights)
  let rangeHhi = 1
  let activeRangeShare = 0
  if (total > 0n) {
    const shares = weights.map((w) => shareOf(w, total))
    rangeHhi = sumSquares(shares)
    activeRangeShare = shares[activeIndex] ?? 0
  }
  return {
    bandPct,
    rangeHhi,
    activeRangeShare,
    owners:
      positions === null
        ? null
        : ownerConcentration(
            positions,
            clipBandToKnownTicks(state, band),
            total,
            new Set(excludedOwners.map((owner) => owner.toLowerCase())),
          ),
  }
}

/** Reserve pools are one full range: rangeHhi = 1, activeRangeShare = 1, owners unknown. */
export function computeConcentrationForReserves(
  _state: ConstantProductState | StableSwapState,
  bandPct: number = CONCENTRATION_BAND_PCT,
): ConcentrationMetrics {
  return { bandPct, rangeHhi: 1, activeRangeShare: 1, owners: null }
}
