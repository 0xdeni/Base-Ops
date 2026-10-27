/**
 * The mirrored depth curve (CH3 and C9, docs/design/visual-v3.md §5.9, §3.7 part 1): the
 * Pool focal. Sell side left of mid, buy side right, measured points only on a log-spaced x, the
 * ±2 % band in `well`, and the field of light: side-colour dots on a lattice anchored at the spine
 * and the baseline, their opacity ramping from `--field-top` to `--field-low`, over a faint solid
 * underlay. Pure SVG, so print and export keep it. The pointer snaps to the nearest measured point
 * (crosshair, the point grows, the tooltip opens); arrow keys step, Escape and blur clear (CH2).
 */
import { type PointerEvent, type ReactNode, useRef, useState } from 'react'
import type { PoolSnapshotDto } from '../../api/types.js'
import { pct, usd, usdTick } from '../../lib/format.js'
import { latticePitch, pathD } from '../../lib/scale.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { ChartTooltip } from './ChartTooltip.js'
import {
  CURVE_X_TICKS,
  type CurvePoint,
  clampTickX,
  curveGeometry,
  curveLabel,
  curvePoints,
  nearestPoint,
  pointText,
} from './curveModel.js'
import { ShowData } from './ShowData.js'
import { devicePixelRatio, useChartWidth, useSvgId } from './useChartWidth.js'
import './charts.css'
import './series.css'

interface Token {
  symbol: string
  decimals: number
}

export interface DepthCurveProps {
  /** The latest snapshot, sides as stored: the sell side sells token0, the buy side buys it. */
  snapshot: PoolSnapshotDto
  token0: Token
  token1: Token
  /** The "Show data" table (CH9). */
  children?: ReactNode
}

function Field({
  id,
  W,
  H,
  P,
  R,
  cx,
  top,
  base,
}: {
  id: string
  W: number
  H: number
  P: number
  R: number
  cx: number
  top: number
  base: number
}) {
  const at = { x: (cx - P / 2).toFixed(2), y: (base - P / 2).toFixed(2) }
  const pattern = (side: 'sell' | 'buy') => (
    <pattern
      id={`${id}-ht-${side}`}
      width={P}
      height={P}
      patternUnits="userSpaceOnUse"
      x={at.x}
      y={at.y}
    >
      <circle cx={P / 2} cy={P / 2} r={R} style={{ fill: `var(--${side})` }} />
    </pattern>
  )
  const under = (side: 'sell' | 'buy') => (
    <linearGradient
      id={`${id}-u-${side}`}
      x1="0"
      y1={top}
      x2="0"
      y2={base}
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" style={{ stopColor: `var(--${side})`, stopOpacity: 'var(--field-under)' }} />
      <stop offset="1" style={{ stopColor: `var(--${side})`, stopOpacity: 0 }} />
    </linearGradient>
  )
  const edge = Math.min(0.49, 40 / Math.max(1, W))
  return (
    <defs>
      {pattern('sell')}
      {pattern('buy')}
      <pattern
        id={`${id}-lat`}
        width={P * 4}
        height={P * 4}
        patternUnits="userSpaceOnUse"
        x={at.x}
        y={at.y}
      >
        <circle cx={P / 2} cy={P / 2} r={0.9} style={{ fill: 'var(--dot)' }} />
      </pattern>
      <linearGradient
        id={`${id}-fade`}
        x1="0"
        y1={top}
        x2="0"
        y2={base}
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" style={{ stopColor: '#fff', stopOpacity: 'var(--field-top)' }} />
        <stop
          offset="0.55"
          style={{ stopColor: '#fff', stopOpacity: 'calc(var(--field-top) * 0.55)' }}
        />
        <stop offset="1" style={{ stopColor: '#fff', stopOpacity: 'var(--field-low)' }} />
      </linearGradient>
      <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
        <rect width={W} height={H} fill={`url(#${id}-fade)`} />
      </mask>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset={edge.toFixed(4)} stopColor="#fff" />
        <stop offset={(1 - edge).toFixed(4)} stopColor="#fff" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <mask id={`${id}-em`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
        <rect width={W} height={H} fill={`url(#${id}-edge)`} />
      </mask>
      {under('sell')}
      {under('buy')}
    </defs>
  )
}

export function DepthCurve({ snapshot, token0, token1, children }: DepthCurveProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const W = useChartWidth(wrapRef)
  const phone = useIsPhone()
  const id = useSvgId('dc')
  const [sel, setSel] = useState(-1)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const points = curvePoints(snapshot, token0, token1)
  const g = curveGeometry(points, W, phone)
  const P = latticePitch(devicePixelRatio(), phone)
  const R = phone ? 1 : 1.3
  const { top, base, cx, fx, fy, H } = g

  const select = (i: number, withTip: boolean) => {
    setSel(i)
    const p = points[i]
    const r = svgRef.current?.getBoundingClientRect()
    setAnchor(p && r && withTip ? { x: r.left + fx(p.pct), y: r.top + fy(p.usd) } : null)
  }
  const clear = () => {
    setSel(-1)
    setAnchor(null)
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = nearestPoint(points, fx, e.clientX - r.left)
    if (i >= 0 && (i !== sel || !anchor)) select(i, true)
  }

  const missing = (side: 'sell' | 'buy') => !points.some((p) => p.side === side)
  if (!points.length) {
    return (
      <p className="chart-note">
        Neither {token0.symbol} nor {token1.symbol} has a USD price, so depth is not drawn.
      </p>
    )
  }

  const area = (ps: [number, number][]) => {
    const last = ps[ps.length - 1] ?? [cx, base]
    return `${pathD(ps)}L${last[0].toFixed(2)} ${fy(0).toFixed(2)}Z`
  }
  const line = (ps: [number, number][], out: number) => {
    if (out < 0) return { solid: pathD(ps), dashed: '' }
    return { solid: pathD(ps.slice(0, out)), dashed: pathD(ps.slice(out - 1)) }
  }
  const sides = (['sell', 'buy'] as const).filter((s) => !missing(s))
  const label = (p: CurvePoint) => {
    const px = fx(p.pct)
    const left = p.pct < 0
    return (
      <text
        key={`l${p.pct}`}
        className="chart-label"
        x={(px + (left ? 10 : -10)).toFixed(1)}
        y={(fy(p.usd) - 12).toFixed(1)}
        textAnchor={left ? 'start' : 'end'}
      >
        {usd(p.usd)}
      </text>
    )
  }
  const selected = sel >= 0 ? points[sel] : undefined
  const band = { x: fx(-2), w: fx(2) - fx(-2) }

  return (
    <>
      <div className="curve" ref={wrapRef}>
        <div className="curve-legend" aria-hidden="true">
          <span>
            <span className="sw sell" />
            Sell side, price down
          </span>
          <span>
            <span className="sw buy" />
            Buy side, price up
          </span>
        </div>
        <svg
          ref={svgRef}
          className="chart-svg chart-focus"
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys step through the measured points (CH2)
          tabIndex={0}
          aria-label={curveLabel(points)}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={clear}
          onBlur={clear}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              select(Math.min(points.length - 1, sel + 1), true)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              select(sel < 0 ? points.length - 1 : Math.max(0, sel - 1), true)
            } else if (e.key === 'Escape') clear()
          }}
        >
          <Field id={id} W={W} H={H} P={P} R={R} cx={cx} top={top} base={base} />
          <rect
            x="0"
            y={top - 8}
            width={W}
            height={base - top + 8}
            fill={`url(#${id}-lat)`}
            mask={`url(#${id}-em)`}
          />
          <rect
            className="curve-band"
            x={band.x.toFixed(1)}
            y={top - 8}
            width={band.w.toFixed(1)}
            height={base - top + 8}
          />
          {sides.map((s) => (
            <path key={`u${s}`} d={area(g[s])} fill={`url(#${id}-u-${s})`} />
          ))}
          <g mask={`url(#${id}-m)`}>
            {sides.map((s) => (
              <path key={`h${s}`} d={area(g[s])} fill={`url(#${id}-ht-${s})`} />
            ))}
          </g>
          <line className="curve-spine" x1={cx} x2={cx} y1={top - 8} y2={base} />
          {g.yTicks.map((v) => (
            <text key={v} className="chart-text halo-well" x={cx} y={fy(v) + 4} textAnchor="middle">
              {usdTick(v)}
            </text>
          ))}
          {sides.map((s) => {
            const l = line(g[s], g.exhausted[s])
            return (
              <g key={`p${s}`}>
                {l.solid ? <path className={`c-line ${s}`} d={l.solid} /> : null}
                {l.dashed ? <path className={`c-line ${s} is-exhausted`} d={l.dashed} /> : null}
              </g>
            )
          })}
          {(['sell', 'buy'] as const).map((s) => {
            const at = g[s][g.exhausted[s]]
            if (g.exhausted[s] < 0 || !at) return null
            return (
              <text
                key={`x${s}`}
                className="chart-text halo-canvas"
                x={at[0] + (s === 'sell' ? 8 : -8)}
                y={at[1] - 26}
                textAnchor={s === 'sell' ? 'start' : 'end'}
              >
                Liquidity runs out
              </text>
            )
          })}
          {selected ? (
            <line
              className="xh"
              x1={fx(selected.pct)}
              x2={fx(selected.pct)}
              y1={top - 8}
              y2={base}
            />
          ) : null}
          {points.map((p, i) => (
            <circle
              key={p.pct}
              className={`pt ${p.side}`}
              cx={fx(p.pct).toFixed(1)}
              cy={fy(p.usd).toFixed(1)}
              r={i === sel ? 5 : 3.5}
            />
          ))}
          {points.filter((p) => Math.abs(p.pct) === 2).map(label)}
          {(['sell', 'buy'] as const).filter(missing).map((s) => (
            <text
              key={`m${s}`}
              className="chart-text"
              x={s === 'sell' ? cx / 2 : cx + cx / 2}
              y={(top + base) / 2}
              textAnchor="middle"
            >
              {(s === 'sell' ? token0 : token1).symbol} has no USD price
            </text>
          ))}
          <line className="curve-base" x1="0" x2={W} y1={base} y2={base} />
          {CURVE_X_TICKS.map((v) => (
            <text
              key={v}
              className="chart-text"
              x={clampTickX(fx(v), W).toFixed(1)}
              y={H - 8}
              textAnchor="middle"
            >
              {v === 0 ? 'Mid' : pct(v)}
            </text>
          ))}
        </svg>
        <span className="sr-only" aria-live="polite">
          {selected ? pointText(selected) : ''}
        </span>
      </div>
      {selected && anchor ? (
        <ChartTooltip
          x={anchor.x}
          y={anchor.y}
          prefer={selected.pct < 0 ? 'left' : 'right'}
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
      <ShowData>{children}</ShowData>
    </>
  )
}
