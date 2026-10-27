/**
 * One market-maker mandate in a row list (ia-v3 §4.1, §4.3, §4.5; docs/design/visual-v3.md §6.1,
 * §6.5), shared by the Home preview, the Scorecards list and Pool's "Mandates on this pool": the
 * status as shape plus word with no fill (K5, so a list never turns into a wall of red), the
 * mandate name linking to its scorecard (the row's one tab stop), "Alice Markets on USDC / AERO",
 * then the 7 d uptime over a bullet with its target tick. The Scorecards list may add a middle cell
 * (its 7 d uptime strip).
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ScorecardSummaryDto } from '../../api/types.js'
import { NB, uptime } from '../../lib/format.js'
import { mmHref } from '../../lib/scorecard.js'
import { BulletGraph } from '../charts/BulletGraph.js'
import { StatusWord } from './StatusWord.js'

/** The bullet's accessible name: the 7 d uptime against its target, or that there is none yet. */
export function uptimeLabel(d7: number | null, target: number): string {
  return d7 === null
    ? `No 7 day uptime yet; the target is ${uptime(target)}`
    : `7 day uptime ${uptime(d7)} against a ${uptime(target)} target`
}

export function MandateRow({
  summary,
  where,
  strip,
}: {
  summary: ScorecardSummaryDto
  /** Where the mandate is, after "on": "USDC / AERO" or "USDC / AERO, Aerodrome v2". */
  where: string
  /** A middle cell between the mandate and its uptime (the Scorecards list's strip). */
  strip?: ReactNode
}) {
  const d7 = summary.uptime.d7.uptime
  const target = summary.mandate.kpis.targetUptime
  const withStrip = strip !== undefined && strip !== null
  return (
    <li>
      <div className={`rl-row mm-row${withStrip ? ' has-strip' : ''}`}>
        <div className="cell-pool">
          <StatusWord status={summary.status} />
          <Link className="pp rl-link" to={mmHref(summary.mandate.id)}>
            {summary.mandate.name}
          </Link>
          <span className="pd">
            {summary.mandate.marketMaker} on {where}
          </span>
        </div>
        {strip}
        <div className="mm-up">
          <span className="num">
            {uptime(d7)} <span className="faint small">7{NB}d</span>
          </span>
          <BulletGraph value={d7} target={target} label={uptimeLabel(d7, target)} />
        </div>
      </div>
    </li>
  )
}
