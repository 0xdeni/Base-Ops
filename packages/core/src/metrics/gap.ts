/**
 * Liquidity gap: real volume against thin depth.
 * `turnover = volume24hUsd / depth2Usd`; `gapScore = 100 · clamp(log10(turnover) / 2, 0, 1)`
 * (turnover 1× → 0, 100× → 100). Null when volume or depth is unknown or depth is 0.
 */

import { clamp } from '../math.js'
import type { GapMetrics } from '../types.js'

/** Minimum 24 h volume for a pool to appear in the gaps feed. */
export const GAP_FEED_MIN_VOLUME_USD = 10_000

/**
 * Turnover from which a feed pool is a meaningful gap: a day's volume at least 3× its ±2 % depth
 * (a gap score of 23.86). The feed's `meaningful` count and every screen use this threshold.
 */
export const MEANINGFUL_GAP_TURNOVER = 3

/** True when the turnover is known and at least MEANINGFUL_GAP_TURNOVER. */
export function isMeaningfulGap(gap: Pick<GapMetrics, 'turnoverRatio'>): boolean {
  return gap.turnoverRatio !== null && gap.turnoverRatio >= MEANINGFUL_GAP_TURNOVER
}

export function computeGap(volume24hUsd: number | null, depth2Usd: number | null): GapMetrics {
  const base: GapMetrics = { volume24hUsd, depth2Usd, turnoverRatio: null, gapScore: null }
  if (
    volume24hUsd === null ||
    depth2Usd === null ||
    !Number.isFinite(volume24hUsd) ||
    !Number.isFinite(depth2Usd) ||
    depth2Usd <= 0 ||
    volume24hUsd < 0
  )
    return base
  const turnoverRatio = volume24hUsd / depth2Usd
  const gapScore = turnoverRatio <= 0 ? 0 : 100 * clamp(Math.log10(turnoverRatio) / 2, 0, 1)
  return { volume24hUsd, depth2Usd, turnoverRatio, gapScore }
}
