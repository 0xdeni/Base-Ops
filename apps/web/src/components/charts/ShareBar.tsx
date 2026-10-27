/**
 * Who provides it (docs/design/visual-v3.md §5.9 "Share bar"): one 8 px bar split into the top LP
 * (`text-1`), the next two (`control`) and everyone else (`border`), with 2 px gaps; the legend
 * uses 8 px swatches at 13 px `text-2`, then the owner count in `text-3`. The shares come from the
 * snapshot's concentration (`top1Share`, `top3Share`), read as stored; a tiny part reads "under
 * 1 %", never "0 %" (N4).
 */
import type { ReactNode } from 'react'
import { NB, shareOf } from '../../lib/format.js'
import { ShowData } from './ShowData.js'
import './charts.css'
import './glyphs.css'

export interface ShareParts {
  top: number
  next: number
  rest: number
}

/** The three parts of the bar, each clamped to [0, 1]. */
export function shareParts(top1: number, top3: number): ShareParts {
  const top = Math.min(1, Math.max(0, top1))
  const upTo3 = Math.min(1, Math.max(top, top3))
  return { top, next: upTo3 - top, rest: 1 - upTo3 }
}

export function ShareBar({
  top1Share,
  top3Share,
  owners,
  bandPct,
  children,
}: {
  top1Share: number
  top3Share: number
  /** Owners with a share of the in-band liquidity. */
  owners: number
  /** The concentration band, ±5 %. */
  bandPct: number
  children?: ReactNode
}) {
  const p = shareParts(top1Share, top3Share)
  const words = {
    top: `Top LP ${shareOf(p.top)}`,
    next: `Next two ${shareOf(p.next)}`,
    rest: `Everyone else ${shareOf(p.rest)}`,
  }
  return (
    <>
      <div className="share-wrap">
        <div
          className="share"
          role="img"
          aria-label={`${words.top}, ${words.next.toLowerCase()}, ${words.rest.toLowerCase()}`}
        >
          <i className="sh s1" style={{ flexGrow: p.top }} />
          {p.next > 0 ? <i className="sh s2" style={{ flexGrow: p.next }} /> : null}
          <i className="sh s3" style={{ flexGrow: Math.max(0.004, p.rest) }} />
        </div>
        <div className="share-legend" aria-hidden="true">
          <span>
            <i className="lsw s1" />
            {words.top}
          </span>
          <span>
            <i className="lsw s2" />
            {words.next}
          </span>
          <span>
            <i className="lsw s3" />
            {words.rest}
          </span>
          <span className="faint">
            {owners} {owners === 1 ? 'owner' : 'owners'} within ±{bandPct}
            {NB}%
          </span>
        </div>
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
