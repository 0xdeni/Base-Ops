/**
 * Time-series small multiples (CH5, docs/design/visual-v3.md §5.9): Pool "Over time" (depth ±2 %
 * and spread at $10K) and the scorecard's measured spread. Stacked plots sharing one x axis, 2 px
 * `text-1` lines with round joins and no fill, the p10–median band as a `hover` rect, two nice y
 * ticks right-aligned in a 52 px pad (64 px when a series has a reference line, which is dashed
 * `text-2` and labelled there), UTC time landmarks. No dual axes. Gaps in the series are not
 * interpolated: they are dashed `text-3` segments.
 *
 * The x domain is the window's true one (`domain`): 24 h is the tail of 7 d, so a window switch
 * morphs the same points (§4 row 9). Scrubbing (pointer or arrow keys) moves a 1 px crosshair over
 * every multiple and rewrites each head value and time; it pauses while a morph runs.
 */
import { type ReactNode, useRef, useState } from 'react'
import { abs, full } from '../../lib/format.js'
import {
  clearOfEdges,
  linear,
  mix2,
  pathD,
  seriesDomain,
  type TimeTick,
  ticks,
  timeTicks,
} from '../../lib/scale.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { ShowData } from './ShowData.js'
import { seriesRuns } from './seriesRuns.js'
import { useChartWidth, useSvgId } from './useChartWidth.js'
import { useMorph } from './useMorph.js'
import './charts.css'
import './series.css'

export interface MultipleSeries<T> {
  key: string
  label: string
  /** Desktop height in px (×0.7 on phones): 160 for depth, 120 for spread. */
  height: number
  value: (p: T) => number | null
  /** The head value: "$11.2M", "10.4 bps". */
  format: (v: number | null) => string
  /** A y tick: "$12M", "10.0". */
  tick: (v: number) => string
  /** The p10–median band of the window, shaded behind the line. */
  band?: readonly [number, number] | null
  bandLabel?: string
  /** Never crop the y axis to less than this × the window median (0.2 for spread). */
  minSpan?: number
  /**
   * A reference level such as a KPI: a dashed `text-2` line across the plot, labelled in the right
   * pad ("KPI 40.0") and always inside the y domain.
   */
  reference?: { value: number; label: string } | null
}

export interface SmallMultiplesProps<T extends { timestamp: number }> {
  /** Ascending; may extend past `domain` (the 7 d series under a 24 h window). */
  points: readonly T[]
  series: readonly MultipleSeries<T>[]
  /** The window's x domain, unix seconds. */
  domain: readonly [number, number]
  /** "24 hours", "7 days": for the accessible summary. */
  windowLabel: string
  /** The latest window change came from the keyboard: no morph. */
  instant?: boolean
  /**
   * Every multiple shares one y domain, the union of theirs: for series of the same unit compared
   * by height (the market maker's spread over the whole pool's), so 318 bps sits above 187 bps.
   */
  sharedY?: boolean
  onScrub?: (p: T | null) => void
  children?: ReactNode
}

const RIGHT_PAD = 52
/** The right pad when a reference line's label sits in it, as the market-maker chart's gutter. */
const RIGHT_PAD_REF = 64
/** A y tick keeps this far inside the plot, clear of the time axis below and the head above. */
const TICK_EDGE = 8

/** The union of y domains, for multiples that share one scale. */
export function unionDomain(domains: readonly (readonly [number, number])[]): [number, number] {
  if (!domains.length) return [0, 1]
  return [Math.min(...domains.map((d) => d[0])), Math.max(...domains.map((d) => d[1]))]
}

/**
 * The y ticks of one multiple (§5.9): two nice values inside the domain, each at least 8 px inside
 * the plot (a tick on the bottom edge would hang into the time axis), clear of the reference line's
 * label.
 */
export function yTicks(
  yd: readonly [number, number],
  fy: (v: number) => number,
  H: number,
  ref: number | null = null,
): number[] {
  return ticks(yd[0], yd[1], 2)
    .filter((v) => v >= yd[0] && v <= yd[1] && (ref === null || Math.abs(fy(v) - fy(ref)) >= 14))
    .filter((v) => fy(v) >= TICK_EDGE && fy(v) <= H - TICK_EDGE)
    .slice(-2)
}

/**
 * The points a window draws: those inside `dom` plus one neighbour on each side, so the line still
 * runs to the plot's edges. The rest of a longer series (7 d under 24 h) is not drawn off-canvas.
 */
export function pointsAround<T extends { timestamp: number }>(
  points: readonly T[],
  dom: readonly [number, number],
): readonly T[] {
  let a = points.findIndex((p) => p.timestamp >= dom[0])
  if (a < 0) return points.slice(-1)
  let b = points.length - 1
  while (b > a && (points[b]?.timestamp ?? 0) > dom[1]) b--
  a = Math.max(0, a - 1)
  b = Math.min(points.length - 1, b + 1)
  return points.slice(a, b + 1)
}

interface View {
  dom: [number, number]
  yds: [number, number][]
}

export function SmallMultiples<T extends { timestamp: number }>({
  points,
  series,
  domain,
  windowLabel,
  instant = false,
  sharedY = false,
  onScrub,
  children,
}: SmallMultiplesProps<T>) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const W = useChartWidth(wrapRef)
  const phone = useIsPhone()
  const [scrub, setScrub] = useState(-1)
  const uid = useSvgId('ts')
  const inDom = (p: T, dom: readonly [number, number]) =>
    p.timestamp >= dom[0] - 1 && p.timestamp <= dom[1] + 1
  const yFor = (s: MultipleSeries<T>, dom: readonly [number, number]) =>
    seriesDomain(
      points
        .filter((p) => inDom(p, dom))
        .map(s.value)
        .filter((v): v is number => v !== null),
      { band: s.band, minSpan: s.minSpan, reference: s.reference?.value },
    )
  const own = series.map((s) => yFor(s, domain))
  const shared = sharedY ? unionDomain(own) : null
  const target: View = {
    dom: [domain[0], domain[1]],
    yds: shared ? own.map(() => shared) : own,
  }
  const { state, frame, morphing } = useMorph(target, {
    same: (a, b) => a.dom[0] === b.dom[0] && a.dom[1] === b.dom[1],
    mix: (a, b, e) => ({
      dom: mix2(a.dom, b.dom, e),
      yds: b.yds.map((y, i) => mix2(a.yds[i] ?? y, y, e)),
    }),
    instant,
    settleRef: wrapRef,
  })
  const plotW = Math.max(1, W - (series.some((s) => s.reference) ? RIGHT_PAD_REF : RIGHT_PAD))
  const fx = linear(state.dom[0], state.dom[1], 0, plotW)
  // While a range morph runs, both windows' spans are drawn; at rest only the window's own.
  const drawDom: [number, number] = frame
    ? [Math.min(frame.from.dom[0], frame.to.dom[0]), Math.max(frame.from.dom[1], frame.to.dom[1])]
    : state.dom
  const drawn = pointsAround(points, drawDom)
  const latest = points[points.length - 1]
  const cur = scrub >= 0 && !morphing ? points[scrub] : undefined

  const scrubTo = (i: number) => {
    setScrub(i)
    onScrub?.(i >= 0 ? (points[i] ?? null) : null)
  }
  const visibleIdx = () => points.flatMap((p, i) => (inDom(p, state.dom) ? [i] : []))
  const nearest = (x: number) => {
    const t = fx.invert(x)
    let best = -1
    let bd = Number.POSITIVE_INFINITY
    points.forEach((p, i) => {
      if (!inDom(p, state.dom)) return
      const d = Math.abs(p.timestamp - t)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  const tickSvg = (list: TimeTick[], op: number) =>
    clearOfEdges(list, fx, 0, plotW).map(({ t, label }) => (
      <text
        key={`${t}-${op > 0 ? label : ''}`}
        className="chart-text"
        x={fx(t).toFixed(1)}
        y={13}
        textAnchor="middle"
        opacity={op.toFixed(3)}
      >
        {label}
      </text>
    ))
  const span = (d: readonly [number, number]) => d[1] - d[0]
  const axis = frame
    ? [
        ...tickSvg(timeTicks(frame.from.dom, span(frame.from.dom)), Math.max(0, 1 - frame.e * 2.5)),
        ...tickSvg(timeTicks(frame.to.dom, span(frame.to.dom)), Math.max(0, (frame.e - 0.4) / 0.6)),
      ]
    : tickSvg(timeTicks(target.dom, span(target.dom)), 1)

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable group of plots scrubbed with the arrow keys (CH2) */}
      <div
        ref={wrapRef}
        className="ts chart-focus"
        role="group"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys scrub the series (CH2)
        tabIndex={0}
        aria-label={`${series.map((s) => s.label).join(' and ')} over ${windowLabel}. Use the arrow keys to read each snapshot.`}
        onPointerMove={(e) => {
          if (morphing) return
          const r = e.currentTarget.getBoundingClientRect()
          const i = nearest(e.clientX - r.left)
          if (i >= 0 && i !== scrub) scrubTo(i)
        }}
        onPointerLeave={() => scrubTo(-1)}
        onBlur={() => scrubTo(-1)}
        onKeyDown={(e) => {
          const idx = visibleIdx()
          if (!idx.length) return
          let k = idx.indexOf(scrub)
          if (e.key === 'ArrowLeft') k = k < 0 ? idx.length - 1 : Math.max(0, k - 1)
          else if (e.key === 'ArrowRight')
            k = k < 0 ? idx.length - 1 : Math.min(idx.length - 1, k + 1)
          else if (e.key === 'Escape') return scrubTo(-1)
          else return
          e.preventDefault()
          scrubTo(idx[k] ?? -1)
        }}
      >
        {series.map((s, si) => {
          const H = phone ? Math.round(s.height * 0.7) : s.height
          const yd = state.yds[si] ?? [0, 1]
          const fy = linear(yd[0], yd[1], H - 2, 2)
          const runs = seriesRuns(drawn, s.value)
          const ref = s.reference ?? null
          const yt = yTicks(yd, fy, H, ref?.value ?? null)
          const v = cur ? s.value(cur) : latest ? s.value(latest) : null
          const clip = `${uid}-${si}`
          return (
            <div className="mult" key={s.key}>
              <div className="mult-head">
                <span className="ml">{s.label}</span>
                <span className="mv num roll">{s.format(v)}</span>
                <span className="mt num">{cur && cur !== latest ? abs(cur.timestamp) : 'now'}</span>
                {s.band && s.bandLabel ? (
                  <span className="mband">
                    <i />
                    {s.bandLabel}
                  </span>
                ) : null}
              </div>
              <svg
                className="chart-svg"
                role="img"
                aria-label={`${s.label} over ${windowLabel}: latest ${s.format(latest ? s.value(latest) : null)}.`}
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
              >
                <defs>
                  <clipPath id={clip}>
                    <rect x="0" y="-4" width={plotW} height={H + 8} />
                  </clipPath>
                </defs>
                {s.band ? (
                  <rect
                    className="mult-band"
                    x="0"
                    y={fy(s.band[1]).toFixed(1)}
                    width={plotW}
                    height={Math.max(1, fy(s.band[0]) - fy(s.band[1])).toFixed(1)}
                  />
                ) : null}
                {ref ? (
                  <line
                    className="mult-ref"
                    x1="0"
                    x2={plotW}
                    y1={fy(ref.value).toFixed(1)}
                    y2={fy(ref.value).toFixed(1)}
                  />
                ) : null}
                <g clipPath={`url(#${clip})`}>
                  {runs.solid.map((run) => (
                    <path
                      key={run[0]?.timestamp}
                      className="mult-line"
                      d={pathD(run.map((p) => [fx(p.timestamp), fy(p.v)] as const))}
                    />
                  ))}
                  {runs.gaps.map(([a, b]) => (
                    <path
                      key={a.timestamp}
                      className="mult-gap"
                      d={pathD([
                        [fx(a.timestamp), fy(a.v)],
                        [fx(b.timestamp), fy(b.v)],
                      ])}
                    />
                  ))}
                </g>
                {yt.map((t) => (
                  <text
                    key={t}
                    className="chart-text"
                    x={W}
                    y={(fy(t) + 4).toFixed(1)}
                    textAnchor="end"
                  >
                    {s.tick(t)}
                  </text>
                ))}
                {ref ? (
                  <text
                    className="chart-text is-strong"
                    x={W}
                    y={(fy(ref.value) + 4).toFixed(1)}
                    textAnchor="end"
                  >
                    {ref.label}
                  </text>
                ) : null}
                {cur ? (
                  <>
                    <line
                      className="xh"
                      x1={fx(cur.timestamp)}
                      x2={fx(cur.timestamp)}
                      y1={0}
                      y2={H}
                    />
                    {s.value(cur) !== null ? (
                      <circle
                        className="xd"
                        cx={fx(cur.timestamp)}
                        cy={fy(s.value(cur) ?? 0)}
                        r={4}
                      />
                    ) : null}
                  </>
                ) : null}
              </svg>
            </div>
          )
        })}
        <svg className="chart-svg ts-axis" aria-hidden="true" width={W} height={18}>
          {axis}
        </svg>
        <span className="sr-only" aria-live="polite">
          {cur
            ? `${full(cur.timestamp)}: ${series.map((s) => `${s.label} ${s.format(s.value(cur))}`).join(', ')}`
            : ''}
        </span>
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
