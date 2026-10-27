/**
 * The Pool page's sentences (ia-v3 §4.3, docs/design/visual-v3.md §6.3): the answer under the
 * title and each section's takeaway. They only word the stored values (P3, P8); nothing here is a
 * metric, and every number goes through `lib/format.ts`.
 */
import { HEALTH_MAX, type HealthComponents, type HealthScore } from '@depthwatch/core'
import type {
  ConcentrationMetrics,
  PersistenceMetrics,
  PoolDetail,
  SpreadPoint,
} from '../../api/types.js'
import { weakestPart } from '../../components/charts/HealthBar.js'
import {
  bps,
  cantAbsorb,
  NB,
  SPREAD_UNABSORBED_BPS,
  score,
  shareOf,
  uptime,
  usd,
} from '../../lib/format.js'
import { unratedDetail } from '../../lib/rating.js'

const PART_NAME: Readonly<Record<keyof HealthComponents, string>> = {
  depth: 'Depth',
  spread: 'Spread',
  concentration: 'Concentration',
  persistence: 'Persistence',
}

/**
 * "It takes $6.08M of buying to lift WETH 2 % and $5.10M of selling to push it down." It names the
 * pool's first token, whose price the stored sides move (AGENTS.md rule 6): USDC / AERO reads "to
 * lift USDC", the same sides Home and the scorecards show. With an unpriced side it says which
 * token has no USD price; with a side that runs out before 2 % it says how much empties it (CH3).
 */
export function poolAnswer(detail: Pick<PoolDetail, 'pool' | 'latest'>): string {
  const { pool } = detail
  if (!detail.latest) return 'No snapshot yet. Depth appears after the first snapshot.'
  const latest = detail.latest
  const t0 = pool.token0.symbol
  const t1 = pool.token1.symbol
  const usdRow = latest.depthUsd.find((d) => d.pct === 2)
  const raw = latest.depth.find((d) => d.pct === 2)
  const up = usdRow?.upUsd ?? null
  const down = usdRow?.downUsd ?? null
  const upOut = raw?.up.reached === false
  const downOut = raw?.down.reached === false
  if (up === null && down === null)
    return `Depth is unknown in dollars: neither ${t0} nor ${t1} has a USD price.`
  if (upOut || downOut) {
    const side = upOut ? 'buy' : 'sell'
    const v = upOut ? up : down
    const lead = `Liquidity runs out before a 2${NB}% move: ${usd(v)} empties the ${side} side`
    if (upOut && downOut) return `${lead}, and ${usd(down)} empties the sell side.`
    const other = upOut ? down : up
    if (other === null) return `${lead}.`
    return upOut
      ? `${lead}, and ${usd(other)} of selling pushes ${t0} down 2${NB}%.`
      : `${lead}, and ${usd(other)} of buying lifts ${t0} 2${NB}%.`
  }
  if (up === null)
    return `It takes ${usd(down)} of selling to push ${t0} down 2${NB}%. The buy side is unknown: ${t1} has no USD price.`
  if (down === null)
    return `It takes ${usd(up)} of buying to lift ${t0} 2${NB}%. The sell side is unknown: ${t0} has no USD price.`
  return `It takes ${usd(up)} of buying to lift ${t0} 2${NB}% and ${usd(down)} of selling to push it down.`
}

/**
 * The Health takeaway names the component furthest below its weight; for a pool with no grade it
 * says why there is none.
 */
export function healthTakeaway(
  health: HealthScore,
  concentration: ConcentrationMetrics | null,
  kind: string,
): string {
  if (!health.rated) return unratedDetail(health.unratedReason)
  const weakest = weakestPart(health.components)
  if (weakest === 'concentration' && concentration) {
    if (concentration.owners)
      return `Concentration is the weak part: one LP holds ${shareOf(concentration.owners.top1Share)}.`
    if (kind !== 'concentrated')
      return 'Concentration is the weak part: all liquidity is one full range.'
    return `Concentration is the weak part: ${shareOf(concentration.activeRangeShare)} sits in one range.`
  }
  return `${PART_NAME[weakest]} is the weak part: ${score(health.components[weakest])} of ${HEALTH_MAX[weakest]} points.`
}

/** A spread a trade can pay: feasible, and under the 10,000 bps a stored spread can never reach. */
function costs(s: SpreadPoint): s is SpreadPoint & { spreadBps: number } {
  return (
    s.feasible && s.spreadBps !== null && Math.round(Math.abs(s.spreadBps)) < SPREAD_UNABSORBED_BPS
  )
}

/** "A $100K round trip costs 13.8 bps, fees included." for the largest notional the pool absorbs. */
export function costTakeaway(spreads: readonly SpreadPoint[]): string {
  const sorted = [...spreads].sort((a, b) => b.notionalUsd - a.notionalUsd)
  const largest = sorted[0]
  const fillable = sorted.find(costs)
  if (!largest) return 'No round trip was measured in the latest snapshot.'
  if (!fillable) return `The pool can’t absorb a ${usd(sorted.at(-1)?.notionalUsd)} round trip.`
  if (fillable === largest)
    return `A ${usd(fillable.notionalUsd)} round trip costs ${bps(fillable.spreadBps)}, fees included.`
  return `The pool can’t absorb ${usd(largest.notionalUsd)}; a ${usd(fillable.notionalUsd)} round trip costs ${bps(fillable.spreadBps)}.`
}

/** One notional's spread in the Details table: basis points, or "Can’t absorb $10K". */
export function spreadCellText(s: SpreadPoint): string {
  return costs(s) ? bps(s.spreadBps) : cantAbsorb(s.notionalUsd)
}

/** "One LP holds 53 % of the liquidity near the price.", or the active range when owners are not indexed. */
export function whoTakeaway(concentration: ConcentrationMetrics | null, kind: string): string {
  if (!concentration) return 'No concentration data in the latest snapshot.'
  if (concentration.owners)
    return `One LP holds ${shareOf(concentration.owners.top1Share)} of the liquidity near the price.`
  if (kind !== 'concentrated') return 'A full-range pool: every LP shares one range.'
  return `${shareOf(concentration.activeRangeShare)} of the liquidity sits in the active range.`
}

/** The persistence takeaway's two values for a window (they change with the window control). */
export function persistenceParts(p: PersistenceMetrics | null): {
  uptime: string
  samples: string
} | null {
  if (!p || p.uptime === null) return null
  return { uptime: uptime(p.uptime), samples: String(p.samples) }
}

/** The stored spread of one notional ($10K for the facts); null when the pool cannot absorb it. */
export function spreadAt(spreads: readonly SpreadPoint[], notional: number): number | null {
  const s = spreads.find((x) => x.notionalUsd === notional)
  return s !== undefined && costs(s) ? s.spreadBps : null
}
