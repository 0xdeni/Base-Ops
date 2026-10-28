/**
 * The plot of the depth butterfly (docs/design/visual-v4.md §5.9.1): the "All of …" total row as
 * per-pool segments with the hatched rest, the bracket on the deepest pool, the pool rows and the
 * mirrored axis. Every width is a fraction of the model's one scale. Bars carry `data-bar` so the
 * first view can grow them from the spine; the readout, totals and axis are chart furniture.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { count, NB, poolHref, ratio, usd, usdTick } from '../../lib/format.js'
import {
  type ButterflyModel,
  type ButterflyRow,
  bracketText,
  rowLinkLabel,
  type Segment,
} from './butterflyModel.js'
import { vars } from './useChartWidth.js'

const pct = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`

/** A bar's width: 0 for an empty or unknown side, at least 2 px otherwise. */
export function barWidth(w: number, value: number | null): string {
  return value !== null && value > 0 ? `max(2px, ${pct(w)})` : '0px'
}

/**
 * Whether a row's label fits left of its sell bar on a `trackPx`-wide side with a `lanePx` lane:
 * the pair at 15 px / 750 and the venue at 13 px run about 8.6 and 6.8 px a glyph. A row that
 * would push its label off the figure stacks it on its own line instead.
 */
export function labelFits(
  row: Pick<ButterflyRow, 'pair' | 'venue' | 'sellW'>,
  trackPx: number,
  lanePx: number,
) {
  const need = row.pair.length * 8.6 + 8 + row.venue.length * 6.8 + 12
  return (1 - Math.min(1, row.sellW)) * trackPx + lanePx >= need
}

function Segments({ side, segs }: { side: 's' | 'b'; segs: readonly Segment[] }) {
  const edge = side === 's' ? 'right' : 'left'
  return (
    <>
      {segs.map((s) => (
        <i
          key={s.id ?? 'rest'}
          className={`bf-seg${s.id === null ? ' is-rest' : ''}`}
          style={{ [edge]: pct(s.o), width: pct(s.w) }}
        />
      ))}
    </>
  )
}

export function TotalRow({
  m,
  scope,
  showLabel,
}: {
  m: ButterflyModel
  scope: string
  /** The label fits left of the sell side; it stays in the DOM, hidden, when it does not. */
  showLabel: boolean
}) {
  const ws = m.max > 0 ? m.total.sell / m.max : 0
  const rest = m.rest.count
    ? ` Hatched: the other ${count(m.rest.count)} ${m.rest.count === 1 ? 'pool' : 'pools'}.`
    : ''
  return (
    <div
      className="bf-r bf-total"
      role="img"
      aria-label={`All of ${scope}: ${usd(m.total.sell)} on the sell side and ${usd(m.total.buy)} on the buy side within 2${NB}%.${rest}`}
    >
      <div
        className={`bf-lab${showLabel ? '' : ' is-off'}`}
        data-furniture=""
        style={vars({ '--ws': ws.toFixed(4) })}
      >
        <b>All of {scope}</b>
      </div>
      <div className="bf-h bf-h--s">
        <div className="bf-t" data-bar="">
          <Segments side="s" segs={m.segments.sell} />
        </div>
      </div>
      <div className="bf-h bf-h--b">
        <div className="bf-t" data-bar="">
          <Segments side="b" segs={m.segments.buy} />
        </div>
      </div>
    </div>
  )
}

export function Bracket({ m }: { m: ButterflyModel }) {
  const b = m.bracket
  if (!b) return null
  return (
    <div className="bf-call" data-furniture="" aria-hidden="true">
      <div className="bf-h bf-h--s">
        <div className="bf-t">
          <i className="bf-call-in s" style={{ width: pct(b.sellW) }} />
        </div>
      </div>
      <div className="bf-h bf-h--b">
        <div className="bf-t">
          <i className="bf-call-in b" style={{ width: pct(b.buyW) }} />
        </div>
      </div>
      <p className="bf-call-t">{bracketText(b)}</p>
    </div>
  )
}

export interface RowProps {
  row: ButterflyRow
  index: number
  on: boolean
  stacked: boolean
  scope: string
  /** The row of the biggest meaningful gap: a dotted leader and "Gap" after its buy bar. */
  gap: { turnoverRatio: number } | null
}

export function PoolRow({ row, index, on, stacked, scope, gap }: RowProps) {
  return (
    <li className={`bf-r${on ? ' is-on' : ''}${stacked ? ' is-stacked' : ''}`} data-k={index}>
      <div className="bf-lab" data-furniture="" style={vars({ '--ws': row.sellW.toFixed(4) })}>
        <b>{row.pair}</b>
        <span className="meta">{row.venue}</span>
      </div>
      <div className="bf-h bf-h--s">
        <div className="bf-t">
          <i className="bf-b" data-bar="" style={{ width: barWidth(row.sellW, row.sell) }} />
        </div>
      </div>
      <div className="bf-h bf-h--b">
        <div className="bf-t">
          <i className="bf-b" data-bar="" style={{ width: barWidth(row.buyW, row.buy) }} />
          {gap ? (
            <Link
              className="bf-gap"
              data-furniture=""
              to="/gaps"
              style={{ left: `calc(${barWidth(row.buyW, row.buy)} + 10px)` }}
              aria-label={`Liquidity gap: ${row.pair} trades ${ratio(gap.turnoverRatio)} its depth a day`}
            >
              Gap
            </Link>
          ) : null}
        </div>
      </div>
      <Link className="bf-link" to={poolHref(row.id)} aria-label={rowLinkLabel(row, scope)} />
    </li>
  )
}

export function Axis({ m, kept }: { m: ButterflyModel; kept: readonly number[] }): ReactNode {
  const at = (v: number) => pct(v / m.max)
  return (
    <div className="bf-axis" data-furniture="" aria-hidden="true">
      <div className="bf-ticks s">
        {kept.map((v) => (
          <span key={v} style={{ left: pct(1 - v / m.max) }}>
            {usdTick(v)}
          </span>
        ))}
      </div>
      <div className="bf-ticks b">
        <span style={{ left: 0 }}>0</span>
        {kept.map((v) => (
          <span key={v} style={{ left: at(v) }}>
            {usdTick(v)}
          </span>
        ))}
      </div>
    </div>
  )
}
