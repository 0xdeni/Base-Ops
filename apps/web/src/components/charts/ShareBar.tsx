/**
 * Who provides it (docs/design/visual-v4.md §5.9.8): one 32 px bar of the liquidity within the
 * concentration band, the measured part in ink (at least 6 px) and the rest hatched in
 * `--line-2`, with a legend under it. With owners indexed it splits into the top LP (ink), the
 * next two (`--text-2`) and everyone else (hatched); without them it shows the active tick range
 * against every other range in the band. Shares are read as stored; a tiny part reads "under
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

/** The three parts of the owners bar, each clamped to [0, 1]. */
export function shareParts(top1: number, top3: number): ShareParts {
  const top = Math.min(1, Math.max(0, top1))
  const upTo3 = Math.min(1, Math.max(top, top3))
  return { top, next: upTo3 - top, rest: 1 - upTo3 }
}

type ShareBarProps = {
  /** The concentration band, ±5 %. */
  bandPct: number
  children?: ReactNode
} & (
  | {
      top1Share: number
      top3Share: number
      /** Owners with a share of the in-band liquidity. */
      owners: number
      activeShare?: undefined
    }
  | {
      /** The active tick range's share of the in-band liquidity, when owners are not indexed. */
      activeShare: number
      top1Share?: undefined
    }
)

const pctOf = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`

export function ShareBar(props: ShareBarProps) {
  const band = `±${props.bandPct}${NB}%`
  if (props.top1Share === undefined) {
    const a = Math.min(1, Math.max(0, props.activeShare))
    return (
      <>
        <div className="share-wrap">
          <div
            className="share"
            role="img"
            aria-label={`Active range ${shareOf(a)} of the liquidity within ${band}`}
          >
            <i className="sh s1" style={{ flexBasis: `max(6px, ${pctOf(a)})` }} />
            {a < 1 ? <i className="sh s3" /> : null}
          </div>
          <p className="legend" aria-hidden="true">
            <span>
              <i className="sw ink" />
              Active range {shareOf(a)}
            </span>
            <span>
              <span className="hatch is-rest" />
              Every other range within {band}
            </span>
          </p>
        </div>
        <ShowData>{props.children}</ShowData>
      </>
    )
  }
  const p = shareParts(props.top1Share, props.top3Share)
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
          <i className="sh s1" style={{ flexBasis: `max(6px, ${pctOf(p.top)})` }} />
          {p.next > 0 ? <i className="sh s2" style={{ flexBasis: pctOf(p.next) }} /> : null}
          {p.rest > 0 ? <i className="sh s3" /> : null}
        </div>
        <p className="legend" aria-hidden="true">
          <span>
            <i className="sw ink" />
            {words.top}
          </span>
          <span>
            <i className="sw t2" />
            {words.next}
          </span>
          <span>
            <span className="hatch is-rest" />
            {words.rest}
          </span>
          <span>
            {props.owners} {props.owners === 1 ? 'owner' : 'owners'} within {band}
          </span>
        </p>
      </div>
      <ShowData>{props.children}</ShowData>
    </>
  )
}
