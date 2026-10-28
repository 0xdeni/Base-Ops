/**
 * The mirrored depth curve (CH3, docs/design/visual-v4.md §5.9.3): the Pool focal, on the band.
 * Sell side left of mid, buy side right, on a log-spaced x; each side a flat area (white, Yellow)
 * through its measured points only, closed to the baseline at ±5 %, never past it. The ±2 % band
 * is white 8 %; the points are 12 px rounded squares ringed in their side's colour. Two direct
 * labels sit above the plot at ±2 % on desktop; phones read them in a row above the chart.
 *
 * The pointer snaps to the nearest measured point: a dashed crosshair, the point grows to 16 px
 * and the tooltip shows. A mouse clears it on leaving the plot; on touch the first tap reads the
 * nearest point and keeps it until a tap elsewhere, a second tap on it, blur or Escape, like the
 * butterfly and the field. Arrow keys step through the points, Escape and blur clear (CH2). The
 * tooltip follows its point when the page scrolls.
 *
 * A snapshot whose measured levels all hold $0 has no range to draw: one sentence stands in for
 * the plot (no ticks, no labels, no points) and the foot row stays.
 */
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { PoolSnapshotDto } from '../../api/types.js'
import { MINUS, NB, pct, tokenText, usd, usdTick } from '../../lib/format.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { ChartTooltip } from './ChartTooltip.js'
import {
  areaPath,
  CURVE_X_TICKS,
  type CurveGeometry,
  type CurvePoint,
  clampTickX,
  curveGeometry,
  curveLabel,
  curvePoints,
  emptyNote,
  nearestPoint,
  outPath,
  pointText,
  twoPct,
} from './curveModel.js'
import { ShowData } from './ShowData.js'
import { useChartWidth } from './useChartWidth.js'
import './charts.css'
import './curve.css'

interface Token {
  symbol: string
  /** The API's display label (`tokenText`). */
  label?: string
  decimals: number
}

export interface DepthCurveProps {
  /** The latest snapshot, sides as stored: the sell side sells token0, the buy side buys it. */
  snapshot: PoolSnapshotDto
  token0: Token
  token1: Token
  /** The centre of the legend row: the band's eyebrow heading. */
  heading?: ReactNode
  /** The "Show data" table (CH9). */
  children?: ReactNode
}

const sideWord = (p: CurvePoint) => `${p.pct < 0 ? 'Sell' : 'Buy'} ${pct(p.pct)}`

/** A direct label above the plot: the key, the value and a dashed leader down to the point. */
function DirectLabel({ p, g }: { p: CurvePoint; g: CurveGeometry }) {
  const x = g.fx(p.pct)
  return (
    <g className="cv-lab" data-furniture="">
      <line className="lead-l" x1={x} x2={x} y1={g.top - 10} y2={g.fy(p.usd) - 12} />
      <text className="lab-k" x={x} y={g.top - 52} textAnchor="middle">
        {sideWord(p)}
      </text>
      <text className="lab-v" x={x} y={g.top - 18} textAnchor="middle">
        {usd(p.usd)}
      </text>
    </g>
  )
}

export function DepthCurve({ snapshot, token0, token1, heading, children }: DepthCurveProps) {
  const wrapRef = useRef<HTMLElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const W = useChartWidth(wrapRef)
  const phone = useIsPhone()
  const [sel, setSel] = useState(-1)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const points = curvePoints(snapshot, token0, token1)
  const g = curveGeometry(points, W, phone)
  const { top, base, cx, fx, fy, H } = g

  const select = (i: number) => {
    setSel(i)
    const p = points[i]
    const r = svgRef.current?.getBoundingClientRect()
    setAnchor(p && r ? { x: r.left + fx(p.pct), y: r.top + fy(p.usd) } : null)
  }
  const clear = () => {
    setSel(-1)
    setAnchor(null)
  }
  const nearestAt = (e: { clientX: number; currentTarget: Element }) =>
    nearestPoint(points, fx, e.clientX - e.currentTarget.getBoundingClientRect().left)
  /** The kind of the latest press on the plot: a tap reads on its click, a mouse on the move. */
  const pointer = useRef('mouse')
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse') return
    const i = nearestAt(e)
    if (i >= 0 && i !== sel) select(i)
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    pointer.current = e.pointerType
    if (e.pointerType === 'mouse') onMove(e)
  }
  // A tap (a click that follows a touch or pen press, so never a scroll) reads the nearest point;
  // a second tap on the point that is read clears it.
  const onTap = (e: MouseEvent<SVGSVGElement>) => {
    if (pointer.current === 'mouse') return
    const i = nearestAt(e)
    if (i < 0) return
    if (i === sel) clear()
    else select(i)
  }
  const reanchor = useRef(() => {})
  reanchor.current = () => {
    if (sel >= 0) select(sel)
  }

  // While a point is read: a press outside the plot clears it, and a scroll or resize moves the
  // tooltip with its point.
  const reading = sel >= 0
  useEffect(() => {
    if (!reading) return
    const outside = (e: globalThis.PointerEvent) => {
      if (svgRef.current?.contains(e.target as Node)) return
      setSel(-1)
      setAnchor(null)
    }
    const follow = () => reanchor.current()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', follow, { passive: true })
    window.addEventListener('resize', follow)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', follow)
      window.removeEventListener('resize', follow)
    }
  }, [reading])

  const missing = (side: 'sell' | 'buy') => !points.some((p) => p.side === side)
  const sell2 = twoPct(points, 'sell')
  const buy2 = twoPct(points, 'buy')
  const head = (
    <div className="cv-head" data-furniture="">
      <span className="meta">
        <i className="sw sell-band" aria-hidden="true" />
        Sell side, price down
      </span>
      <div className="cv-mid">{heading}</div>
      <span className="meta">
        <i className="sw buy-band" aria-hidden="true" />
        Buy side, price up
      </span>
    </div>
  )
  const foot = (
    <ShowData
      band
      className="cv-foot"
      note={`Straight lines join measured points only. Nothing is drawn past ±5${NB}%.`}
    >
      {children}
    </ShowData>
  )
  if (!points.length) {
    return (
      <div className="cv-wrap" data-chart="">
        {head}
        <p className="cv-empty">
          Neither {tokenText(token0)} nor {tokenText(token1)} has a USD price, so depth is not
          drawn.
        </p>
      </div>
    )
  }
  if (g.empty) {
    return (
      <div className="cv-wrap" data-chart="">
        {head}
        <p className="cv-empty">{emptyNote(points, token0, token1)}</p>
        {foot}
      </div>
    )
  }

  const selected = sel >= 0 ? points[sel] : undefined
  const band = { x: fx(-2), w: fx(2) - fx(-2) }
  const sides = (['sell', 'buy'] as const).filter((s) => !missing(s))
  return (
    <div className="cv-wrap" data-chart="">
      {head}
      <div className="cv-read" data-furniture="" aria-hidden="true">
        <span>
          <small>
            Sell {MINUS}2{NB}%
          </small>
          {usd(sell2?.usd ?? null)}
        </span>
        <span>
          <small>Buy +2{NB}%</small>
          {usd(buy2?.usd ?? null)}
        </span>
      </div>
      <figure className="cv" ref={wrapRef}>
        <svg
          ref={svgRef}
          className="chart-svg"
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys step through the measured points (CH2)
          tabIndex={0}
          aria-label={curveLabel(points)}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onClick={onTap}
          onPointerLeave={(e) => {
            // A finger lifting fires pointerleave too: only a mouse leaving the plot clears.
            if (e.pointerType === 'mouse') clear()
          }}
          onBlur={clear}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') select(Math.min(points.length - 1, sel + 1))
            else if (e.key === 'ArrowLeft')
              select(sel < 0 ? points.length - 1 : Math.max(0, sel - 1))
            else if (e.key === 'Escape') clear()
            else return
            e.preventDefault()
          }}
        >
          <rect
            className="cv-band"
            x={band.x.toFixed(1)}
            y={top - 6}
            width={band.w.toFixed(1)}
            height={base - top + 6}
          />
          <g className="cv-areas" data-area="">
            {sides.map((s) => {
              const d = areaPath(g[s], g.exhausted[s], base)
              return d ? <path key={s} className={`cv-area ${s}`} d={d} /> : null
            })}
          </g>
          {sides.map((s) => {
            const d = outPath(g[s], g.exhausted[s])
            return d ? <path key={`o${s}`} className={`cv-out ${s}`} d={d} /> : null
          })}
          <line className="cv-mid-line" x1={cx} x2={cx} y1={top - 6} y2={base} />
          <g data-furniture="">
            {g.yTicks.map((v) => (
              <text key={v} className="ax" x={cx + 8} y={fy(v) + 4}>
                {usdTick(v)}
              </text>
            ))}
            {(['sell', 'buy'] as const).map((s) => {
              const at = g[s][g.exhausted[s]]
              if (g.exhausted[s] < 0 || !at) return null
              return (
                <text
                  key={`x${s}`}
                  className="ax is-strong"
                  x={at[0] + (s === 'sell' ? 10 : -10)}
                  y={at[1] - 14}
                  textAnchor={s === 'sell' ? 'start' : 'end'}
                >
                  Liquidity runs out
                </text>
              )
            })}
            {(['sell', 'buy'] as const).filter(missing).map((s) => (
              <text
                key={`m${s}`}
                className="ax is-strong"
                x={s === 'sell' ? cx / 2 : cx + cx / 2}
                y={(top + base) / 2}
                textAnchor="middle"
              >
                {tokenText(s === 'sell' ? token0 : token1)} has no USD price
              </text>
            ))}
          </g>
          {selected ? (
            <line
              className="xh"
              x1={fx(selected.pct)}
              x2={fx(selected.pct)}
              y1={top - 6}
              y2={fy(selected.usd) - 8}
            />
          ) : null}
          {points.map((p, i) => {
            const r = i === sel ? 8 : 6
            return (
              <rect
                key={p.pct}
                className={`cv-pt ${p.side}${i === sel ? ' is-on' : ''}`}
                data-pt=""
                x={(fx(p.pct) - r).toFixed(1)}
                y={(fy(p.usd) - r).toFixed(1)}
                width={r * 2}
                height={r * 2}
                rx={3}
              />
            )
          })}
          {phone ? null : (
            <>
              {sell2 ? <DirectLabel p={sell2} g={g} /> : null}
              {buy2 ? <DirectLabel p={buy2} g={g} /> : null}
            </>
          )}
          <g data-furniture="">
            {CURVE_X_TICKS.map((v) => (
              <text
                key={v}
                className="ax"
                x={clampTickX(fx(v), W).toFixed(1)}
                y={H - 6}
                textAnchor="middle"
              >
                {v === 0 ? 'Mid' : pct(v)}
              </text>
            ))}
          </g>
        </svg>
        <span className="sr-only" aria-live="polite">
          {selected ? pointText(selected) : ''}
        </span>
      </figure>
      {selected && anchor ? (
        <ChartTooltip
          x={anchor.x}
          y={anchor.y}
          prefer="right"
          swatch={selected.side}
          title={`${pct(selected.pct)}, ${selected.side} side`}
          rows={[
            { key: 'd', label: 'Depth', value: usd(selected.usd) },
            {
              key: 'a',
              label: selected.side === 'buy' ? 'Spent' : 'Sold',
              value: selected.amount,
            },
            {
              key: 'p',
              label: 'Price',
              value: selected.reached ? 'Reached' : 'Liquidity runs out',
            },
          ]}
        />
      ) : null}
      {foot}
    </div>
  )
}
