/**
 * Methodology's three schematics (ia-v3 §4.8, docs/design/visual-v4.md §6.9): the mirrored depth
 * curve, the persistence sparkline with its p10–median band, and the scorecard's KPI lines with a
 * breach band. Each is drawn in the visual language of the chart it explains (flat fills, square
 * points, Cerulean for the sell side and Yellow with an ink edge for the buy side), from fixed
 * illustrative shapes: no axis carries a number (the page shows no data numbers outside
 * formulas), and every figure says it is an illustration.
 */
import { computePersistence } from '@depthwatch/core'
import { type ReactNode, useRef } from 'react'
import { useChartWidth } from '../../components/charts/useChartWidth.js'
import { pct } from '../../lib/format.js'
import { linear, logPctX, pathD } from '../../lib/scale.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import '../../components/charts/charts.css'
import '../../components/charts/series.css'

type Pt = readonly [number, number]

/** A figure and its one-sentence caption. */
export function Figure({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="doc-fig">
      {children}
      <figcaption className="doc-cap">{caption}</figcaption>
    </figure>
  )
}

const tickX = (x: number, w: number) => Math.min(w - 14, Math.max(14, x))

/** Relative depth reached at 1, 2 and 5 % from the mid price; the sell side runs out after 2 %. */
const DEPTH_SHAPE = {
  sell: [0.27, 0.48, 0.8],
  buy: [0.31, 0.57, 1],
} as const
const DEPTH_LEVELS = [1, 2, 5] as const

/** A 10 px rounded-square point, centred on (x, y). */
function Pt({ x, y, className }: { x: number; y: number; className: string }) {
  return <rect className={className} x={x - 5} y={y - 5} width={10} height={10} rx={3} />
}

export function DepthSchematic() {
  const ref = useRef<HTMLDivElement | null>(null)
  const w = useChartWidth(ref, 560)
  const h = useIsPhone() ? 168 : 200
  const top = 28
  const base = h - 26
  const cx = w / 2
  /**
   * Below 440 px "Depth at −2 %" no longer fits between its point and the spine: the labels
   * shorten to "−2 %" and "+2 %" and stay at their points (the x ticks and band name the level).
   */
  const narrow = w < 440
  const fx = (p: number) => logPctX(p, cx, w / 2 - 6)
  const fy = linear(0, 1, base, top)
  const side = (s: 'sell' | 'buy') => {
    const k = s === 'sell' ? -1 : 1
    return DEPTH_LEVELS.map((p, i): Pt => [fx(k * p), fy(DEPTH_SHAPE[s][i] ?? 0)])
  }
  const sell = side('sell')
  const buy = side('buy')
  const [s1, s2, s5] = sell as [Pt, Pt, Pt]
  const [, b2] = buy as [Pt, Pt, Pt]
  const area = (pts: readonly Pt[]) => {
    const last = pts[pts.length - 1] ?? [cx, base]
    return `${pathD([[cx, base], ...pts, [last[0], base]])}Z`
  }
  return (
    <Figure caption="Illustration. Each point is the dollars it takes to reach that level on one side; a dashed line means the pool ran out of liquidity first.">
      <div className="curve-legend" aria-hidden="true">
        <span>
          <i className="sw sell" />
          Sell side, price down
        </span>
        <span>
          <i className="sw buy" />
          Buy side, price up
        </span>
      </div>
      <div ref={ref} className="doc-plot">
        <svg
          className="chart-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label="Illustration of a mirrored depth curve: dollars needed to move the price 1, 2 and 5 % down on the sell side and up on the buy side."
        >
          <rect
            className="curve-band"
            x={fx(-2)}
            y={top}
            width={fx(2) - fx(-2)}
            height={base - top}
          />
          <path className="doc-area sell" d={area([s1, s2])} />
          <path className="doc-area buy" d={area(buy)} />
          <line className="curve-spine" x1={cx} x2={cx} y1={top} y2={base} />
          <path className="c-line sell" d={pathD([[cx, base], s1, s2])} />
          <path className="c-line sell is-exhausted" d={pathD([s2, s5])} />
          <path className="doc-edge" d={pathD([[cx, base], ...buy])} />
          <path className="c-line buy" d={pathD([[cx, base], ...buy])} />
          {sell.map(([x, y]) => (
            <Pt key={`s${x}`} x={x} y={y} className="doc-pt sell" />
          ))}
          {buy.map(([x, y]) => (
            <Pt key={`b${x}`} x={x} y={y} className="doc-pt buy" />
          ))}

          {/* Anchored like the pool curve's labels: inward of the ±2 % points, 12 px above. */}
          <text
            className="chart-label halo-canvas"
            x={s2[0] + 10}
            y={s2[1] - 12}
            textAnchor="start"
          >
            {narrow ? pct(-2) : `Depth at ${pct(-2)}`}
          </text>
          <text className="chart-label halo-canvas" x={b2[0] - 10} y={b2[1] - 12} textAnchor="end">
            {narrow ? pct(2) : `Depth at ${pct(2)}`}
          </text>
          <text className="chart-text is-strong halo-canvas" x={s5[0] + 8} y={s5[1] - 10}>
            Liquidity runs out
          </text>

          <line className="curve-base" x1="0" x2={w} y1={base} y2={base} />
          {[-5, -2, -1, 0, 1, 2, 5].map((p) => (
            <text key={p} className="chart-text" x={tickX(fx(p), w)} y={h - 8} textAnchor="middle">
              {p === 0 ? 'Mid' : pct(p)}
            </text>
          ))}
        </svg>
      </div>
    </Figure>
  )
}

/** A week of snapshots, every 6 h, with one pulled-liquidity dip (relative ±2 % depth). */
const WEEK = [
  0.97, 1.08, 1.15, 1.06, 0.95, 0.9, 0.99, 1.1, 1.04, 1.12, 1.18, 1.07, 0.93, 0.88, 0.96, 1.05, 1.0,
  0.36, 0.58, 0.84, 0.97, 1.09, 1.14, 1.02, 0.94, 1.0, 1.11, 1.06,
] as const
const HOUR = 3600
/** Median and p10 come from core, so the drawn band is exactly what the metric would read. */
const WEEK_PERSISTENCE = computePersistence(
  WEEK.map((d, i) => ({ timestamp: (i + 1) * 6 * HOUR, depthUsd: d })),
  WEEK.length * 6,
  WEEK.length * 6 * HOUR,
)

export function PersistenceSchematic() {
  const ref = useRef<HTMLDivElement | null>(null)
  const w = useChartWidth(ref, 560)
  const h = useIsPhone() ? 104 : 128
  const pad = 56
  const top = 8
  const base = h - 8
  const fx = linear(0, WEEK.length - 1, 0, w - pad)
  // The axis starts under the dip, so the band and the dashed line get the height (no number shows).
  const fy = linear(Math.min(...WEEK) - 0.06, Math.max(...WEEK) + 0.04, base, top)
  const median = WEEK_PERSISTENCE.depthUsdMedian ?? 1
  const p10 = WEEK_PERSISTENCE.depthUsdP10 ?? median
  const half = median / 2
  const line = WEEK.map((d, i): Pt => [fx(i), fy(d)])
  const down = line.filter((_, i) => (WEEK[i] ?? 0) < half)
  const right = w - pad + 8
  return (
    <Figure caption="Illustration of a week of snapshots. Stability is the band’s floor over its top; uptime counts the snapshots above the dashed line.">
      <div ref={ref} className="doc-plot">
        <svg
          className="chart-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label="Illustration of depth over a week: the band runs from the 10th percentile to the median, and one snapshot falls below half the median."
        >
          <rect
            className="mult-band"
            x={0}
            y={fy(median)}
            width={w - pad}
            height={fy(p10) - fy(median)}
          />
          <line className="mult-gap" x1={0} x2={w - pad} y1={fy(half)} y2={fy(half)} />
          <path className="mult-line" d={pathD(line)} />
          {down.map(([x, y]) => (
            <Pt key={x} x={x} y={y} className="doc-ring" />
          ))}

          <text
            className="chart-text is-strong"
            x={right}
            y={fy(median) - 4}
            dominantBaseline="middle"
          >
            Median
          </text>
          <text
            className="chart-text is-strong"
            x={right}
            y={fy(p10) + 6}
            dominantBaseline="middle"
          >
            p10
          </text>
          <text className="chart-text halo-canvas" x={0} y={fy(half) - 7}>
            Half the median
          </text>
        </svg>
      </div>
    </Figure>
  )
}

/** A day of samples as multiples of the KPI depth; the sell side dips below it for four samples. */
const KPI_DAY = {
  buy: [
    1.42, 1.46, 1.5, 1.47, 1.41, 1.38, 1.4, 1.45, 1.49, 1.52, 1.48, 1.43, 1.39, 1.36, 1.33, 1.35,
    1.4, 1.44, 1.47, 1.5, 1.46, 1.42, 1.4, 1.44,
  ],
  sell: [
    1.3, 1.27, 1.32, 1.36, 1.33, 1.29, 1.26, 1.3, 1.34, 1.31, 1.28, 1.24, 1.18, 0.82, 0.66, 0.61,
    0.74, 1.12, 1.22, 1.28, 1.31, 1.27, 1.25, 1.29,
  ],
} as const
/** The symmetric scale's maximum, in KPI multiples (as the scorecard chart rounds up). */
const KPI_M = 1.8

/** Contiguous runs of samples with either side under the KPI: [first, last] indices. */
function breachRuns(): Array<readonly [number, number]> {
  const runs: Array<[number, number]> = []
  KPI_DAY.buy.forEach((b, i) => {
    const under = b < 1 || (KPI_DAY.sell[i] ?? 1) < 1
    const last = runs[runs.length - 1]
    if (!under) return
    if (last && last[1] === i - 1) last[1] = i
    else runs.push([i, i])
  })
  return runs
}

export function KpiSchematic() {
  const ref = useRef<HTMLDivElement | null>(null)
  const w = useChartWidth(ref, 560)
  const h = useIsPhone() ? 128 : 160
  const pad = 48
  const mid = h / 2
  const n = KPI_DAY.buy.length
  const fx = linear(0, n - 1, 0, w - pad)
  const fy = linear(0, KPI_M, 0, mid - 8)
  const up = KPI_DAY.buy.map((v, i): Pt => [fx(i), mid - fy(v)])
  const dn = KPI_DAY.sell.map((v, i): Pt => [fx(i), mid + fy(v)])
  const step = fx(1) - fx(0)
  return (
    <Figure caption="Illustration of a day of samples. A sample is within KPI only while both sides hold the promised depth; the shaded run is one breach.">
      <div className="legend doc-legend" aria-hidden="true">
        <span>
          <i className="sw buy" />
          Buy side, above
        </span>
        <span>
          <i className="sw sell" />
          Sell side, below
        </span>
        <span>
          <i className="sw breach" />
          Breached
        </span>
      </div>
      <div ref={ref} className="doc-plot">
        <svg
          className="chart-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label="Illustration of a scorecard: buy-side depth above the line and sell-side depth below it, each against a dashed KPI line; the sell side dips under its KPI for four samples, shaded as one breach."
        >
          {breachRuns().map(([a, b]) => (
            <rect
              key={a}
              className="mm-band"
              x={Math.max(0, fx(a) - step / 2)}
              y={0}
              width={fx(b) - fx(a) + step}
              height={h}
            />
          ))}
          <line className="mm-zero" x1={0} x2={w - pad} y1={mid} y2={mid} />
          {[-1, 1].map((k) => (
            <line
              key={k}
              className="mm-kpi"
              x1={0}
              x2={w - pad}
              y1={mid - k * fy(1)}
              y2={mid - k * fy(1)}
            />
          ))}
          <path className="mm-line-edge" d={pathD(up)} />
          <path className="mm-line buy" d={pathD(up)} />
          <path className="mm-line sell" d={pathD(dn)} />
          {[-1, 1].map((k) => (
            <text
              key={k}
              className="chart-text is-strong"
              x={w - pad + 8}
              y={mid - k * fy(1)}
              dominantBaseline="middle"
            >
              KPI
            </text>
          ))}
        </svg>
      </div>
    </Figure>
  )
}
