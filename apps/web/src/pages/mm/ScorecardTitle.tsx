/**
 * The Scorecard title block (ia-v3 §4.6, docs/design/visual-v3.md §6.6): the back
 * link to Scorecards, the mandate name as the h1 with the filled status chip inline after it (the
 * page's one filled element, K5), then the meta line: "Alice Markets (synthetic) on USDC / AERO,
 * Aerodrome v2, 0.3 %", the pool as a prose link. Below 600 px the chip leads the meta line instead,
 * so it never sits alone under a wrapped h1 (§6.6).
 */
import { Link } from 'react-router-dom'
import type { ScorecardDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { StatusChip } from '../../components/ui/StatusChip.js'
import { poolHref } from '../../lib/format.js'
import { poolDexFee, poolWords } from './mmText.js'

export function ScorecardTitle({ detail }: { detail: ScorecardDetail }) {
  const { mandate, status } = detail
  const meta = detail.pool?.pool ?? null
  const words = poolWords(mandate.poolId, meta)
  return (
    <div className="title-block">
      <BackLink to="/mm" label="Scorecards" />
      <div className="sc-title">
        <h1 className="h1">{mandate.name}</h1>
        <span className="sc-chip-desk">
          <StatusChip status={status} />
        </span>
      </div>
      <div className="subline sc-sub">
        <span className="sc-chip-phone">
          <StatusChip status={status} compact />
        </span>
        <span>
          {mandate.marketMaker} on{' '}
          <Link className="plink touch-hit" to={poolHref(mandate.poolId)}>
            {words.pair}
          </Link>
          , {meta ? poolDexFee(meta) : words.dex}
        </span>
      </div>
    </div>
  )
}
