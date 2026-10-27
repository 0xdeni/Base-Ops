/**
 * Scorecard summary over a mandate's samples (docs/design/scorecards.md §2): uptime windows,
 * worst excursions, the current streak and the status.
 *
 * Only evaluable samples (`withinKpi !== null`) take part: an unpriced sample is stored but
 * counts neither towards uptime nor towards excursions, and does not interrupt a streak.
 */

import type {
  BreachKind,
  BreachStreak,
  Excursion,
  Mandate,
  MandateKpis,
  MmSample,
  ScorecardStatus,
  ScorecardSummary,
  UptimeWindow,
} from './types.js'
import { UPTIME_WINDOWS_HOURS } from './types.js'

/**
 * Uptime over the window (now − windowHours·3600, now]: evaluable samples inside it and the share
 * of them within KPI (null without samples).
 */
export function computeUptime(
  samples: readonly Pick<MmSample, 'timestamp' | 'withinKpi'>[],
  windowHours: number,
  now: number,
): UptimeWindow {
  const from = now - windowHours * 3600
  let count = 0
  let within = 0
  for (const s of samples) {
    if (s.timestamp <= from || s.timestamp > now || s.withinKpi === null) continue
    count++
    if (s.withinKpi) within++
  }
  return {
    windowHours,
    samples: count,
    withinKpi: within,
    uptime: count === 0 ? null : within / count,
  }
}

interface Candidate {
  sample: MmSample
  value: number | null
}

function toExcursion(c: Candidate | null, kind: BreachKind, threshold: number): Excursion | null {
  if (c === null) return null
  return {
    kind,
    timestamp: c.sample.timestamp,
    blockNumber: c.sample.blockNumber,
    value: c.value,
    threshold,
  }
}

/**
 * The worst evaluable samples: the minimum depthUpUsd, the minimum depthDownUsd (0 is a value)
 * and, with a spread KPI, the maximum spreadBps, where a null spread (infeasible on the market
 * maker's liquidity) is the worst possible value. Ties keep the earliest sample. A side that no
 * sample measured is null.
 */
export function worstExcursions(
  samples: readonly MmSample[],
  kpis: MandateKpis,
): ScorecardSummary['worst'] {
  let minUp: Candidate | null = null
  let minDown: Candidate | null = null
  let maxSpread: Candidate | null = null
  for (const sample of samples) {
    if (sample.withinKpi === null) continue
    const { depthUpUsd, depthDownUsd, spreadBps } = sample.attribution
    if (depthUpUsd !== null && (minUp === null || depthUpUsd < (minUp.value ?? Infinity)))
      minUp = { sample, value: depthUpUsd }
    if (depthDownUsd !== null && (minDown === null || depthDownUsd < (minDown.value ?? Infinity)))
      minDown = { sample, value: depthDownUsd }
    if (kpis.maxSpreadBps === null) continue
    const current = maxSpread === null ? -Infinity : (maxSpread.value ?? Infinity)
    const measured = spreadBps === null ? Infinity : spreadBps
    if (maxSpread === null || measured > current) maxSpread = { sample, value: spreadBps }
  }
  return {
    minDepthUpUsd: toExcursion(minUp, 'depthUp', kpis.minDepthUsd),
    minDepthDownUsd: toExcursion(minDown, 'depthDown', kpis.minDepthUsd),
    maxSpreadBps:
      kpis.maxSpreadBps === null ? null : toExcursion(maxSpread, 'spread', kpis.maxSpreadBps),
  }
}

/**
 * The current streak: walks back from the newest evaluable sample (samples ascending) while
 * `withinKpi` stays equal, skipping unevaluable samples. `since` is the timestamp of the oldest
 * sample of the streak; without evaluable samples the streak is empty and not breached.
 */
export function currentStreak(samples: readonly MmSample[]): BreachStreak {
  let breached: boolean | null = null
  let count = 0
  let since: number | null = null
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i]
    if (sample === undefined || sample.withinKpi === null) continue
    const isBreach = sample.withinKpi === false
    if (breached === null) breached = isBreach
    else if (isBreach !== breached) break
    count++
    since = sample.timestamp
  }
  return { breached: breached ?? false, samples: count, since }
}

/**
 * inactive mandate → 'inactive'; no samples → 'no-data'; latest sample breached → 'breached';
 * latest sample unevaluable → the streak decides ('breached' when it is); otherwise 'ok'.
 */
export function scorecardStatus(
  mandate: Mandate,
  latest: MmSample | null,
  streak: BreachStreak,
): ScorecardStatus {
  if (!mandate.active) return 'inactive'
  if (latest === null) return 'no-data'
  if (latest.withinKpi === false) return 'breached'
  if (latest.withinKpi === null && streak.breached) return 'breached'
  return 'ok'
}

/**
 * The full scorecard over `samples` (ascending, at most the last 30 days): the latest sample,
 * uptime at 24 h / 7 d / 30 d, worst excursions, current streak and status. Samples are sorted
 * by timestamp defensively.
 */
export function summarizeScorecard(
  mandate: Mandate,
  samples: readonly MmSample[],
  now: number,
): ScorecardSummary {
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp)
  const latest = ordered[ordered.length - 1] ?? null
  const streak = currentStreak(ordered)
  return {
    mandate,
    latest,
    uptime: {
      h24: computeUptime(ordered, UPTIME_WINDOWS_HOURS.h24, now),
      d7: computeUptime(ordered, UPTIME_WINDOWS_HOURS.d7, now),
      d30: computeUptime(ordered, UPTIME_WINDOWS_HOURS.d30, now),
    },
    worst: worstExcursions(ordered, mandate.kpis),
    streak,
    status: scorecardStatus(mandate, latest, streak),
  }
}
