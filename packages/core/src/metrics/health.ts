/**
 * Liquidity Health Score (0–100) and rating (docs/METRICS.md, "Liquidity Health Score").
 *
 * - depth (35):         35 · clamp((log10(2 · thinner) − 3) / 3, 0, 1)   thinner $500 → 0, $500k → 35
 *                       thinner = min(±2 % up USD, ±2 % down USD): a one-sided pool scores 0
 * - spread (25):        25 · clamp((log10 300 − log10 spread10kBps) / (log10 300 − log10 10), 0, 1)
 * - concentration (20): owners known → 20 · (1 − top1Share), else 20 · (1 − rangeHhi), else 10
 * - persistence (20):   20 · (0.5 · stability + 0.5 · uptime), else 10 (unknown)
 * Rated: both sides known and the thinner at least HEALTH_RATING_MIN_SIDE_USD.
 * Grade (rated pools only): A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F.
 */

import { clamp } from '../math.js'
import {
  HEALTH_MAX,
  type HealthGrade,
  type HealthInputs,
  type HealthScore,
  type UnratedReason,
} from '../types.js'

export const NOTE_DEPTH_UNKNOWN = 'depth unknown: scored 0'
export const NOTE_SPREAD_INFEASIBLE = 'spread infeasible at $10k: scored 0'
export const NOTE_CONCENTRATION_NEUTRAL = 'concentration neutral: no position or range data'
export const NOTE_PERSISTENCE_NEUTRAL = 'persistence neutral: fewer than 3 samples'
export const NOTE_PERSISTENCE_SHORT = 'persistence neutral: samples cover under 25 % of the window'

/**
 * A pool is rated only when the thinner side of its ±2 % depth holds at least this many USD.
 * Half of the $10,000 spread notional; 50 of the 492 pools of the first live database.
 */
export const HEALTH_RATING_MIN_SIDE_USD = 5_000

const LOG_300 = Math.log10(300)
const LOG_10 = Math.log10(10)

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

function known(x: number | null): x is number {
  return x !== null && Number.isFinite(x)
}

/** The thinner of the two ±2 % sides in USD; null when either side is unknown. */
export function thinnerSideUsd(upUsd: number | null, downUsd: number | null): number | null {
  if (!known(upUsd) || !known(downUsd)) return null
  return Math.min(upUsd, downUsd)
}

export interface DepthRating {
  rated: boolean
  /** Null when rated. */
  unratedReason: UnratedReason | null
}

/** Rated or not, from the two ±2 % sides in USD (docs/METRICS.md, "Rated and unrated pools"). */
export function rateDepth(upUsd: number | null, downUsd: number | null): DepthRating {
  if (!known(upUsd) || !known(downUsd)) return { rated: false, unratedReason: 'unpriced' }
  const thinner = Math.min(upUsd, downUsd)
  if (thinner >= HEALTH_RATING_MIN_SIDE_USD) return { rated: true, unratedReason: null }
  const deeper = Math.max(upUsd, downUsd)
  return {
    rated: false,
    unratedReason: deeper >= HEALTH_RATING_MIN_SIDE_USD ? 'one-sided' : 'thin',
  }
}

function depthScore(thinnerUsd: number | null): number {
  if (thinnerUsd === null || thinnerUsd <= 0) return 0
  return HEALTH_MAX.depth * clamp((Math.log10(2 * thinnerUsd) - 3) / 3, 0, 1)
}

function spreadScore(spreadBps: number): number {
  if (spreadBps <= 0) return HEALTH_MAX.spread
  return HEALTH_MAX.spread * clamp((LOG_300 - Math.log10(spreadBps)) / (LOG_300 - LOG_10), 0, 1)
}

export function healthGrade(total: number): HealthGrade {
  if (total >= 80) return 'A'
  if (total >= 65) return 'B'
  if (total >= 50) return 'C'
  if (total >= 35) return 'D'
  return 'F'
}

export function computeHealthScore(inputs: HealthInputs): HealthScore {
  const notes: string[] = []

  const thinner = thinnerSideUsd(inputs.depth2UpUsd, inputs.depth2DownUsd)
  const depth = depthScore(thinner)
  if (thinner === null) notes.push(NOTE_DEPTH_UNKNOWN)

  let spread = 0
  if (inputs.spread10kBps === null || !Number.isFinite(inputs.spread10kBps)) {
    notes.push(NOTE_SPREAD_INFEASIBLE)
  } else {
    spread = spreadScore(inputs.spread10kBps)
  }

  let concentration: number
  const top1 = inputs.ownerTop1Share
  const rangeHhi = inputs.rangeHhi
  if (top1 !== null && Number.isFinite(top1) && top1 > 0) {
    concentration = HEALTH_MAX.concentration * (1 - clamp(top1, 0, 1))
  } else if (rangeHhi !== null && Number.isFinite(rangeHhi)) {
    concentration = HEALTH_MAX.concentration * (1 - clamp(rangeHhi, 0, 1))
  } else {
    concentration = HEALTH_MAX.concentration / 2
    notes.push(NOTE_CONCENTRATION_NEUTRAL)
  }

  let persistence: number
  const p = inputs.persistence
  if (p === null || p.stability === null || p.uptime === null) {
    persistence = HEALTH_MAX.persistence / 2
    // With 3 or more samples the only way persistence is unknown is the coverage rule.
    notes.push(p !== null && p.samples >= 3 ? NOTE_PERSISTENCE_SHORT : NOTE_PERSISTENCE_NEUTRAL)
  } else {
    persistence =
      HEALTH_MAX.persistence * (0.5 * clamp(p.stability, 0, 1) + 0.5 * clamp(p.uptime, 0, 1))
  }

  const components = {
    depth: round2(depth),
    spread: round2(spread),
    concentration: round2(concentration),
    persistence: round2(persistence),
  }
  const total = round2(
    components.depth + components.spread + components.concentration + components.persistence,
  )
  const { rated, unratedReason } = rateDepth(inputs.depth2UpUsd, inputs.depth2DownUsd)
  return {
    total,
    grade: rated ? healthGrade(total) : null,
    rated,
    unratedReason,
    components,
    notes,
  }
}
