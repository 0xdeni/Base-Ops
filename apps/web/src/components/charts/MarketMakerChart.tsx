/**
 * The market-maker chart over time (docs/design/visual-v4.md §5.9.5, ia-v3 §4.6): the first
 * section of a scorecard, when per-side history exists. The market maker's buy-side depth above a
 * zero line and sell-side depth mirrored below it, on one symmetric scale: 2 px lines, buy Yellow
 * (with its 1 px ink edge in light) and sell Cerulean; the KPI as 1 px dashed `--text-2` lines
 * labelled "KPI $400K"; breach episodes as Red bands at `--breach-op`, full plot height; a dashed
 * registration line when the window reaches back past it; the whole pool as 1 px context lines
 * behind a toggle.
 *
 * Window and context changes morph (§4.3). Scrubbing (pointer or arrow keys) shows a crosshair
 * with a dot on each line, reports the sample through `onScrub` so the page rewrites its facts,
 * and fills the foot row's caption with the status and the full UTC time (CH2).
 */
import { type ReactNode, useRef, useState } from 'react'
import type { MmSampleDto } from '../../api/types.js'
import { day, full } from '../../lib/format.js'
import { clearOfEdges, linear, mix2, pathD, type TimeTick, timeTicks } from '../../lib/scale.js'
import { breachEpisodes, sampleInterval } from '../../lib/scorecard.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { DisclosurePanel, DisclosureTrigger, useDisclosure } from '../ui/Disclosure.js'
import { Shape } from '../ui/Icon.js'
import { bandSpan, mmLabel, mmScaleMax, mmYLabels, sampleStatus } from './mmModel.js'
import { seriesRuns } from './seriesRuns.js'
import { useChartWidth, useSvgId } from './useChartWidth.js'
import { useMorph } from './useMorph.js'
import './charts.css'
import './series.css'

export interface MarketMakerChartProps {
  /** Ascending samples covering at least `domain` (the 30 d series serves every window). */
  points: readonly MmSampleDto[]
  /** The minimum depth per side (`kpis.minDepthUsd`). */
  kpi: number
  /** `mandate.createdAt`: a dashed "Registered 16 Oct" line when the window reaches before it. */
  registeredAt?: number | null
  /** The window's x domain, unix seconds. */
  domain: readonly [number, number]
  /** "7 days", for the accessible summary. */
  windowLabel: string
  /** Draw the whole pool's depth as context lines. */
  wholePool?: boolean
  /** The latest change came from the keyboard: no morph. */
  instant?: boolean
  /** The scrubbed sample (null at rest); `latest` is true for the newest sample. */
  onScrub?: (p: MmSampleDto | null, latest: boolean) => void
  /** The right of the head row: the checkbox and the window control. */
  controls?: ReactNode
  /** The "Show data" table (CH9, ia-v3 §4.6). */
  children?: ReactNode
}

interface View {
  dom: [number, number]
  M: number
  ctx: number
}

export function MarketMakerChart({
  points,
  kpi,
  registeredAt = null,
  domain,
  windowLabel,
  wholePool = false,
  instant = false,
  onScrub,
  controls,
  children,
}: MarketMakerChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const W = useChartWidth(wrapRef)
  const phone = useIsPhone()
  const id = useSvgId('mm')
  const data = useDisclosure()
  const [scrub, setScrub] = useState(-1)
  const target: View = {
    dom: [domain[0], domain[1]],
    M: mmScaleMax(kpi, points, wholePool),
    ctx: wholePool ? 1 : 0,
  }
  const { state, frame, morphing } = useMorph(target, {
    same: (a, b) => a.dom[0] === b.dom[0] && a.dom[1] === b.dom[1] && a.ctx === b.ctx,
    mix: (a, b, e) => ({
      dom: mix2(a.dom, b.dom, e),
      M: a.M + (b.M - a.M) * e,
      ctx: a.ctx + (b.ctx - a.ctx) * e,
    }),
    instant,
    settleRef: svgRef,
  })

  const H = phone ? 240 : 340
  const top = 8
  const bottom = 28
  const rightPad = phone ? 64 : 80
  const plotW = Math.max(1, W - rightPad)
  const { dom, M } = state
  const fx = linear(dom[0], dom[1], 0, plotW)
  const fy = linear(-M, M, H - bottom, top)
  const interval = sampleInterval(points) ?? 7200
  const episodes = breachEpisodes(points)
  const cur = scrub >= 0 && !morphing ? points[scrub] : undefined
  const latest = points[points.length - 1]

  const scrubTo = (i: number) => {
    setScrub(i)
    const p = i >= 0 ? points[i] : undefined
    onScrub?.(p ?? null, p !== undefined && i === points.length - 1)
  }
  const inDom = (p: MmSampleDto) => p.timestamp >= dom[0] - 1 && p.timestamp <= dom[1] + 1
  const nearest = (x: number) => {
    const t = fx.invert(x)
    let best = -1
    let bd = Number.POSITIVE_INFINITY
    points.forEach((p, i) => {
      if (!inDom(p)) return
      const d = Math.abs(p.timestamp - t)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }
  const line = (key: 'depthUpUsd' | 'depthDownUsd' | 'poolDepthUpUsd' | 'poolDepthDownUsd') => {
    const sign = key === 'depthUpUsd' || key === 'poolDepthUpUsd' ? 1 : -1
    const runs = seriesRuns(points, (p) => p.attribution[key])
    return runs.solid
      .map((run) => pathD(run.map((p) => [fx(p.timestamp), fy(sign * p.v)] as const)))
      .join('')
  }
  const span = (d: readonly [number, number]) => d[1] - d[0]
  const tickSvg = (list: TimeTick[], op: number) =>
    clearOfEdges(list, fx, 0, plotW).map(({ t, label }) => (
      <text
        key={`${t}-${op > 0 ? label : ''}`}
        className="chart-text"
        x={fx(t).toFixed(1)}
        y={H - 8}
        textAnchor="middle"
        opacity={op.toFixed(3)}
      >
        {label}
      </text>
    ))
  const inView = (list: TimeTick[]) => list.filter(({ t }) => t >= dom[0] && t <= dom[1])
  const timeAxis = frame
    ? [
        ...tickSvg(inView(timeTicks(dom, span(frame.from.dom))), Math.max(0, 1 - frame.e * 2.5)),
        ...tickSvg(inView(timeTicks(dom, span(frame.to.dom))), Math.max(0, (frame.e - 0.4) / 0.6)),
      ]
    : tickSvg(inView(timeTicks(dom, span(dom))), 1)
  const status = cur ? sampleStatus(cur) : null
  const showReg = registeredAt !== null && registeredAt > dom[0] + 3600 && registeredAt <= dom[1]

  return (
    <div className="mmc-wrap">
      <div className="mmc-head">
        <div className="legend" aria-hidden="true">
          <span>
            <span className="sw buy" />
            Buy side, above
          </span>
          <span>
            <span className="sw sell" />
            Sell side, below
          </span>
          <span>
            <span className="sw breach" />
            Breached
          </span>
        </div>
        {controls ? <div className="mmc-ctl">{controls}</div> : null}
      </div>
      <div className="mmc" ref={wrapRef}>
        <svg
          ref={svgRef}
          className="chart-svg chart-focus"
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys step through the samples (CH2)
          tabIndex={0}
          aria-label={mmLabel(windowLabel, kpi, episodes.length, latest)}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={(e) => {
            if (morphing) return
            const r = e.currentTarget.getBoundingClientRect()
            const i = nearest(e.clientX - r.left)
            if (i !== scrub) scrubTo(i)
          }}
          onPointerLeave={() => scrubTo(-1)}
          onBlur={() => scrubTo(-1)}
          onKeyDown={(e) => {
            const idx = points.flatMap((p, i) => (inDom(p) ? [i] : []))
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
          <defs>
            <clipPath id={`${id}-clip`}>
              <rect x="0" y="0" width={plotW} height={H} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-clip)`}>
            {episodes.map((ep) => {
              const [a, b] = bandSpan(ep, interval)
              return (
                <rect
                  key={ep.start}
                  className="mm-band"
                  x={fx(a).toFixed(1)}
                  y={top}
                  width={Math.max(2, fx(b) - fx(a)).toFixed(1)}
                  height={H - bottom - top}
                />
              )
            })}
            {showReg && registeredAt !== null ? (
              <>
                <line
                  className="mm-reg"
                  x1={fx(registeredAt)}
                  x2={fx(registeredAt)}
                  y1={top}
                  y2={H - bottom}
                />
                <text className="chart-text" x={fx(registeredAt) - 8} y={top + 12} textAnchor="end">
                  Registered {day(registeredAt)}
                </text>
              </>
            ) : null}
            <line className="mm-zero" x1="0" x2={plotW} y1={fy(0)} y2={fy(0)} />
            <line className="mm-kpi" x1="0" x2={plotW} y1={fy(kpi)} y2={fy(kpi)} />
            <line className="mm-kpi" x1="0" x2={plotW} y1={fy(-kpi)} y2={fy(-kpi)} />
            <g className="mm-ctx" opacity={state.ctx.toFixed(3)}>
              {state.ctx > 0 ? (
                <>
                  <path className="mm-ctx-line" d={line('poolDepthUpUsd')} />
                  <path className="mm-ctx-line" d={line('poolDepthDownUsd')} />
                </>
              ) : null}
            </g>
            <path className="mm-line-edge" d={line('depthUpUsd')} />
            <path className="mm-line buy" d={line('depthUpUsd')} />
            <path className="mm-line sell" d={line('depthDownUsd')} />
          </g>
          {mmYLabels(kpi, M, fy).map((l) => (
            <text
              key={l.v}
              className={`chart-text${l.strong ? ' is-strong' : ''}`}
              x={W}
              y={(fy(l.v) + 4).toFixed(1)}
              textAnchor="end"
            >
              {l.text}
            </text>
          ))}
          {timeAxis}
          {cur ? (
            <>
              <line
                className="xh"
                x1={fx(cur.timestamp)}
                x2={fx(cur.timestamp)}
                y1={top}
                y2={H - bottom}
              />
              {cur.attribution.depthUpUsd !== null ? (
                <circle
                  className="xd buy"
                  cx={fx(cur.timestamp)}
                  cy={fy(cur.attribution.depthUpUsd)}
                  r={4}
                />
              ) : null}
              {cur.attribution.depthDownUsd !== null ? (
                <circle
                  className="xd sell"
                  cx={fx(cur.timestamp)}
                  cy={fy(-cur.attribution.depthDownUsd)}
                  r={4}
                />
              ) : null}
            </>
          ) : null}
        </svg>
      </div>
      <div className="mmc-foot">
        {children ? <DisclosureTrigger state={data} label="Show data" /> : null}
        <p className="scrub-cap" aria-live="polite">
          {cur && status ? (
            <>
              <span className={`status tone-${status.tone}`}>
                <Shape
                  shape={
                    status.tone === 'ok' ? 'circle' : status.tone === 'bad' ? 'triangle' : 'ring'
                  }
                />
                {status.text}
              </span>
              <span>{full(cur.timestamp)}</span>
            </>
          ) : null}
        </p>
      </div>
      {children ? <DisclosurePanel state={data}>{children}</DisclosurePanel> : null}
    </div>
  )
}
