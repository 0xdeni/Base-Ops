/**
 * Liquidity gap: real volume against thin depth.
 * `turnover = volume24hUsd / depth2Usd`; `gapScore = 100 · clamp(log10(turnover) / 2, 0, 1)`
 * (turnover 1× → 0, 100× → 100). Null when volume or depth is unknown or depth is 0.
 */

import { clamp } from '../math.js'
import type { GapMetrics } from '../types.js'

/** Minimum 24 h volume for a pool to appear in the gaps feed. */
export const GAP_FEED_MIN_VOLUME_USD = 10_000

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
