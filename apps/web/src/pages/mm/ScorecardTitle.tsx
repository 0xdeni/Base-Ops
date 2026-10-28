/**
 * The Scorecard title section (docs/design/visual-v4.md §6.7): the back link to Scorecards, the
 * eyebrow ("SCORECARD" and "Demo Markets on WETH / AERO, Aerodrome Slipstream 0.3 %"), then a
 * two-column grid from 1024 px. At left the mandate's name as the display title (data, kept as
 * registered), the filled status chip under it (the page's one filled element, K5) and one
 * sentence that says whose liquidity is measured, linking the pool; at right, bottom-aligned, the
 * answer. The title and the answer rise with the first view, the rest fades in.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ScorecardDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { StatusChip } from '../../components/ui/StatusChip.js'
import { poolHref } from '../../lib/format.js'
import { mandateWhere, poolWords } from './mmText.js'

export function ScorecardTitle({
  detail,
  answer,
}: {
  detail: ScorecardDetail
  /** The answer sentence, or its skeleton while the scorecard loads. */
  answer: ReactNode
}) {
  const { mandate, status } = detail
  const meta = detail.pool?.pool ?? null
  const words = poolWords(mandate.poolId, meta)
  return (
    <section className="wrap ttl sc-ttl" aria-labelledby="sc-title">
      <div data-in="">
        <BackLink to="/mm" label="Scorecards" />
      </div>
      <p className="eyebrow eb-row sc-eb" data-in="">
        <span>Scorecard</span> <span>{mandateWhere(mandate, meta)}</span>
      </p>
      <div className="ttl-grid">
        <div className="sc-ttl-main">
          <h1 className="display sc-title" id="sc-title" data-rise="">
            {mandate.name}
          </h1>
          <p className="sc-chip" data-in="">
            <StatusChip status={status} />
          </p>
          <p className="small t2 sc-note" data-in="">
            Measured on the liquidity {mandate.marketMaker} holds in the{' '}
            <Link className="plink touch-hit" to={poolHref(mandate.poolId)}>
              {words.pair} pool
            </Link>
            .
          </p>
        </div>
        {answer}
      </div>
    </section>
  )
}
