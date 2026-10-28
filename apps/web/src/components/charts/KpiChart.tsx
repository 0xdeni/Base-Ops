/**
 * The KPI chart (docs/design/visual-v4.md §5.9.4): the Scorecard focal, on the band. The latest
 * sample's depth per side against the mandate's per-side KPI: two bars from a 2 px white spine on
 * one scale, sell white and buy Yellow, the value inside each bar in ink, the KPI as a dashed
 * white line 24 px beyond the bars on both sides. A side below its KPI shows its shortfall, from
 * the bar's end to the KPI line, as Red hatching; a breach reads in one glance. A side that holds
 * its KPI draws the stretch of the line inside its bar in ink, and its words mask the line where
 * they cross it. On phones a KPI label near the spine is set outward from its line, so the two
 * never meet.
 */
import { type ReactNode, useRef } from 'react'
import { usd } from '../../lib/format.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import {
  KPI_NOTE,
  type KpiSide,
  kpiLabel,
  kpiModel,
  shortfallText,
  sideTitle,
  wordsFit,
} from './kpiModel.js'
import { useChartWidth } from './useChartWidth.js'
import './charts.css'
import './kpi.css'

export interface KpiChartProps {
  /** The latest sample's depth per side within the mandate's band, USD; null when unpriced. */
  sell: number | null
  buy: number | null
  /** The minimum depth per side (`kpis.minDepthUsd`). */
  kpi: number
  /** Per-side depth exists for the latest sample only: the caption says so. */
  latestOnly?: boolean
  /** The centre of the legend row: the band's eyebrow heading. */
  heading?: ReactNode
}

const pct = (f: number) => `${(f * 100).toFixed(3)}%`

/** The words of a side: its title ("Sell" on phones) over the value. */
function Words({
  k,
  className,
  furniture = false,
}: {
  k: KpiSide
  className: string
  furniture?: boolean
}) {
  const title = sideTitle(k)
  const at = title.indexOf(' ')
  return (
    <span className={className} data-furniture={furniture ? '' : undefined}>
      <small>
        {at < 0 ? title : title.slice(0, at)}
        {at < 0 ? null : <span className="long">{title.slice(at)}</span>}
      </small>
      {usd(k.value)}
    </span>
  )
}

/** A KPI line in the inner half of its side: on phones its label is set outward from the line. */
const NEAR_SPINE = 0.5

function Half({ k, kpi, inside }: { k: KpiSide; kpi: number; inside: boolean }) {
  const edge = k.side === 'sell' ? 'right' : 'left'
  const inBar = k.value !== null && k.kpiW < k.w
  return (
    <div className={`kpi-h ${k.side === 'sell' ? 's' : 'b'}`}>
      <b className="kbar" data-bar="" style={{ width: pct(k.w) }} />
      {k.below ? (
        <i
          className="short"
          style={{ [edge]: pct(k.w), width: pct(k.shortW) }}
          aria-hidden="true"
        />
      ) : null}
      {inside ? <Words k={k} className="kpi-in" furniture /> : null}
      <i className="kpi-line" style={{ [edge]: pct(k.kpiW) }} aria-hidden="true" />
      {inBar ? (
        <i
          className="kpi-line-in"
          data-furniture=""
          style={{ [edge]: pct(k.kpiW) }}
          aria-hidden="true"
        />
      ) : null}
      <span
        className={`kpi-lab${k.kpiW < NEAR_SPINE ? ' is-out' : ''}`}
        data-furniture=""
        style={{ [edge]: pct(k.kpiW) }}
        aria-hidden="true"
      >
        KPI {usd(kpi)}
      </span>
    </div>
  )
}

/** The value's size: 24 px up to 52 px with the viewport (`clamp(1.5rem, 1rem + 2.4vw, 3.25rem)`). */
function valuePx(phone: boolean): number {
  if (phone || typeof window === 'undefined') return 24
  return Math.min(52, Math.max(24, 16 + window.innerWidth * 0.024))
}

export function KpiChart({ sell, buy, kpi, latestOnly = false, heading }: KpiChartProps) {
  const figRef = useRef<HTMLElement | null>(null)
  const W = useChartWidth(figRef)
  const phone = useIsPhone()
  const m = kpiModel(sell, buy, kpi)
  const half = W / 2
  const fits = {
    sell: wordsFit(m.sell, half, valuePx(phone), phone),
    buy: wordsFit(m.buy, half, valuePx(phone), phone),
  }
  const short = shortfallText(m)
  return (
    <div className="kpi-wrap" data-chart="">
      <div className="kpi-head" data-furniture="">
        <span className="meta">
          <i className="sw sell-band" aria-hidden="true" />
          Sell side
        </span>
        <div className="kpi-mid">{heading}</div>
        <span className="meta">
          <i className="sw buy-band" aria-hidden="true" />
          Buy side
        </span>
      </div>
      <figure ref={figRef} className="kpi-fig" role="img" aria-label={kpiLabel(m)}>
        <div className="kpi-row">
          <Half k={m.sell} kpi={kpi} inside={fits.sell} />
          <Half k={m.buy} kpi={kpi} inside={fits.buy} />
        </div>
        {fits.sell && fits.buy ? null : (
          <div className="kpi-under" data-furniture="" aria-hidden="true">
            <span>{fits.sell ? null : <Words k={m.sell} className="kpi-out" />}</span>
            <span>{fits.buy ? null : <Words k={m.buy} className="kpi-out" />}</span>
          </div>
        )}
      </figure>
      {short || latestOnly ? (
        <p className="kpi-cap" data-furniture="">
          {short ? (
            <span>
              <span className="hatch is-short" aria-hidden="true" />
              {short}
            </span>
          ) : null}
          {latestOnly ? <span>{KPI_NOTE}</span> : null}
        </p>
      ) : null}
    </div>
  )
}
