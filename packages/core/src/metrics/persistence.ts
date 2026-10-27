/**
 * Liquidity persistence over a window: samples are the snapshots inside the window with a
 * non-null depth; `stability = clamp(p10 / median, 0, 1)`; `uptime` = share of samples at or above
 * half the median. Both are null (unknown) with fewer than 3 samples; with 3 or more they are 0
 * when the median is 0 (a dead pool), else null when the samples span less than
 * PERSISTENCE_MIN_COVERAGE of the window (docs/METRICS.md, "Liquidity persistence").
 */

import { clamp, percentile } from '../math.js'
import type { PersistenceMetrics } from '../types.js'

/** Share of the window the oldest and newest sample must be apart: 6 h of 24 h, 42 h of 7 d. */
export const PERSISTENCE_MIN_COVERAGE = 0.25

export interface PersistenceSample {
  /** Unix seconds. */
  timestamp: number
  depthUsd: number | null
}

export function computePersistence(
  samples: ReadonlyArray<PersistenceSample>,
  windowHours: number,
  now: number,
): PersistenceMetrics {
  const from = now - windowHours * 3600
  const depths: number[] = []
  // A loop, not Math.min(...depths): spread arguments overflow the stack on long series.
  let depthUsdMin = Number.POSITIVE_INFINITY
  let oldest = Number.POSITIVE_INFINITY
  let newest = Number.NEGATIVE_INFINITY
  for (const s of samples) {
    if (s.timestamp <= from || s.timestamp > now) continue
    if (s.depthUsd === null || !Number.isFinite(s.depthUsd) || s.depthUsd < 0) continue
    depths.push(s.depthUsd)
    if (s.depthUsd < depthUsdMin) depthUsdMin = s.depthUsd
    if (s.timestamp < oldest) oldest = s.timestamp
    if (s.timestamp > newest) newest = s.timestamp
  }
  const count = depths.length
  if (count === 0) {
    return {
      windowHours,
      samples: 0,
      depthUsdMedian: null,
      depthUsdP10: null,
      depthUsdMin: null,
      stability: null,
      uptime: null,
    }
  }
  const depthUsdMedian = percentile(depths, 50)
  const depthUsdP10 = percentile(depths, 10)
  const result = (stability: number | null, uptime: number | null): PersistenceMetrics => ({
    windowHours,
    samples: count,
    depthUsdMedian,
    depthUsdP10,
    depthUsdMin,
    stability,
    uptime,
  })
  if (count < 3) return result(null, null)
  // A zero median is a dead pool: "at least half of nothing" holds for every sample, so without
  // this it would count as always up. It has nothing to keep, so coverage does not matter.
  if (depthUsdMedian <= 0) return result(0, 0)
  if (newest - oldest < PERSISTENCE_MIN_COVERAGE * windowHours * 3600) return result(null, null)
  const stability = clamp(depthUsdP10 / depthUsdMedian, 0, 1)
  let healthy = 0
  for (const d of depths) if (d >= 0.5 * depthUsdMedian) healthy++
  return result(stability, healthy / count)
}
