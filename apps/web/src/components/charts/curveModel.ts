/**
 * Data and geometry of the mirrored depth curve (CH3, docs/design/visual-v4.md §5.9.3): the
 * measured ±1/2/5 % levels of one snapshot, read as stored (never extrapolated past ±5 %), on a
 * log-spaced x and a linear y from 0. Pure, so the geometry is testable without layout.
 */
import type { PoolSnapshotDto } from '../../api/types.js'
import { amount, DASH, NB, pct, usd } from '../../lib/format.js'
import { linear, logPctX, niceStepUp } from '../../lib/scale.js'

interface Token {
  symbol: string
  decimals: number
}

export interface CurvePoint {
  side: 'sell' | 'buy'
  /** Signed: −5 … +5. */
  pct: number
  usd: number
  /**
   * The token amount traded to get there: token0 sold (sell side), token1 spent (buy side), "—"
   * when the level has no raw amount. Shown for every token, a $1.00 one included, so the tooltip
   * keeps one shape on both sides (CH2).
   */
  amount: string
  /** False when liquidity ran out before the move: the amount empties the side. */
  reached: boolean
}

function tokenText(raw: string, token: Token): string {
  const text = amount(raw, token.decimals)
  return text === DASH ? DASH : `${text}${NB}${token.symbol}`
}

/** The ticks along x (CH3). */
export const CURVE_X_TICKS: readonly number[] = [-5, -2, -1, 0, 1, 2, 5]

/** Heights and plot insets: 340 px tall with 72 px above the plot for the labels; 240 on phones. */
export const CURVE_SIZE = {
  desktop: { H: 340, top: 72 },
  phone: { H: 240, top: 16 },
  bottom: 28,
} as const

/**
 * The measured points of a snapshot, left to right. A level whose side has no USD price is left
 * out (a missing level shows a sentence instead of a shape).
 */
export function curvePoints(snapshot: PoolSnapshotDto, token0: Token, token1: Token): CurvePoint[] {
  const out: CurvePoint[] = []
  for (const row of snapshot.depthUsd) {
    if (row.pct > 5) continue
    const raw = snapshot.depth.find((d) => d.pct === row.pct)
    if (row.downUsd !== null)
      out.push({
        side: 'sell',
        pct: -row.pct,
        usd: row.downUsd,
        amount: raw ? tokenText(raw.down.amountIn, token0) : DASH,
        reached: raw ? raw.down.reached : true,
      })
    if (row.upUsd !== null)
      out.push({
        side: 'buy',
        pct: row.pct,
        usd: row.upUsd,
        amount: raw ? tokenText(raw.up.amountIn, token1) : DASH,
        reached: raw ? raw.up.reached : true,
      })
  }
  return out.sort((a, b) => a.pct - b.pct)
}

export interface CurveGeometry {
  W: number
  H: number
  /** The plot's top and baseline (y of 0). */
  top: number
  base: number
  cx: number
  fx: (pct: number) => number
  fy: (usd: number) => number
  /**
   * True when every measured level holds $0: there is no range to scale, so the figure draws its
   * empty state (no ticks, no labels, no points) instead of a plot.
   */
  empty: boolean
  /** The y step and the axis top: `ceil(1.06 × max / step) × step`; 0 when `empty`. */
  step: number
  yMax: number
  /** Tick values every two steps, labelled 8 px right of the spine; none when `empty`. */
  yTicks: number[]
  /** Spine first, then outward, per side: [x, y] of each measured point. */
  sell: [number, number][]
  buy: [number, number][]
  /** Index into each side's path where liquidity first runs out (-1 when it never does). */
  exhausted: { sell: number; buy: number }
}

export function curveGeometry(
  points: readonly CurvePoint[],
  W: number,
  phone: boolean,
): CurveGeometry {
  const size = phone ? CURVE_SIZE.phone : CURVE_SIZE.desktop
  const { H, top } = size
  const base = H - CURVE_SIZE.bottom
  const cx = W / 2
  const half = W / 2 - 10
  const fx = (p: number) => logPctX(p, cx, half)
  const max = Math.max(0, ...points.map((p) => p.usd))
  const empty = !(max > 0)
  const step = empty ? 0 : niceStepUp(max * 1.06, 5)
  const yMax = empty ? 0 : Math.ceil((max * 1.06) / step) * step
  // An empty figure has no range: every value sits on the baseline.
  const fy = empty ? () => base : linear(0, yMax, base, top)
  const yTicks: number[] = []
  if (!empty)
    for (let v = step * 2; v <= yMax * (1 + 1e-9); v += step * 2)
      yTicks.push(Number(v.toPrecision(12)))
  const sideOf = (side: 'sell' | 'buy') =>
    points.filter((p) => p.side === side).sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct))
  const path = (side: 'sell' | 'buy'): [number, number][] => [
    [cx, fy(0)],
    ...sideOf(side).map((p): [number, number] => [fx(p.pct), fy(p.usd)]),
  ]
  // The path index (spine = 0) of the first point that did not reach its move.
  const firstOut = (side: 'sell' | 'buy') => {
    const i = sideOf(side).findIndex((p) => !p.reached)
    return i < 0 ? -1 : i + 1
  }
  return {
    W,
    H,
    top,
    base,
    cx,
    fx,
    fy,
    empty,
    step,
    yMax,
    yTicks,
    sell: path('sell'),
    buy: path('buy'),
    exhausted: { sell: firstOut('sell'), buy: firstOut('buy') },
  }
}

/**
 * A side's flat area: from the spine through the reached points, closed down to the baseline.
 * Past the point where liquidity runs out the side is a dashed segment instead (`outPath`).
 */
export function areaPath(
  path: readonly [number, number][],
  exhausted: number,
  base: number,
): string {
  const pts = exhausted < 0 ? path : path.slice(0, exhausted)
  if (pts.length < 2) return ''
  const last = pts[pts.length - 1] ?? [0, base]
  return `${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')}L${last[0].toFixed(2)} ${base.toFixed(2)}Z`
}

/** The dashed segment from the last reached point through the points that ran out; '' if none. */
export function outPath(path: readonly [number, number][], exhausted: number): string {
  if (exhausted < 1) return ''
  return path
    .slice(exhausted - 1)
    .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join('')
}

/**
 * The sentence that stands in for the plot when every measured level holds $0 (§5.9.3, as for a
 * missing level): "No liquidity sits within 5 % of the price at this snapshot." A side with no USD
 * price is named as such, since its depth is unknown rather than zero.
 */
export function emptyNote(points: readonly CurvePoint[], token0: Token, token1: Token): string {
  const sell = points.some((p) => p.side === 'sell')
  const buy = points.some((p) => p.side === 'buy')
  if (sell === buy) return `No liquidity sits within 5${NB}% of the price at this snapshot.`
  const unpriced = sell ? token1 : token0
  return `No liquidity sits within 5${NB}% of the price on the ${sell ? 'sell' : 'buy'} side at this snapshot; ${unpriced.symbol} has no USD price.`
}

/** The x of a tick label, clamped 16 px inside the edges. */
export function clampTickX(x: number, W: number): number {
  return Math.min(W - 16, Math.max(16, x))
}

/** The point whose x is nearest to `x` (the pointer snaps to measured points). */
export function nearestPoint(points: readonly CurvePoint[], fx: (p: number) => number, x: number) {
  let best = -1
  let bd = Number.POSITIVE_INFINITY
  points.forEach((p, i) => {
    const d = Math.abs(fx(p.pct) - x)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** The ±2 % point of a side, for the direct labels and the phone readout row. */
export function twoPct(
  points: readonly CurvePoint[],
  side: 'sell' | 'buy',
): CurvePoint | undefined {
  return points.find((p) => p.side === side && Math.abs(p.pct) === 2)
}

/** The figure's accessible summary, level by level. */
export function curveLabel(points: readonly CurvePoint[]): string {
  const side = (s: 'sell' | 'buy') =>
    points
      .filter((p) => p.side === s)
      .sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct))
      .map((p) => `${usd(p.usd)} to move ${pct(p.pct)}${p.reached ? '' : ' (liquidity runs out)'}`)
      .join(', ')
  return `Depth curve. Sell side: ${side('sell') || 'no USD price'}. Buy side: ${side('buy') || 'no USD price'}. Use the arrow keys to step through the measured points.`
}

/** One point in words, for the live region while stepping with the keyboard. */
export function pointText(p: CurvePoint): string {
  const verb = p.side === 'buy' ? 'spent' : 'sold'
  const traded = p.amount === DASH ? '' : `, ${p.amount} ${verb}`
  return `${pct(p.pct)}, ${p.side} side: ${usd(p.usd)}${traded}, ${p.reached ? 'reached' : 'liquidity runs out'}`
}

/**
 * The Show data takeaway: "Buying meets 10 % more depth than selling at ±2 %." Null when a side is
 * unpriced at ±2 %.
 */
export function asymmetryNote(snapshot: PoolSnapshotDto): string | null {
  const two = snapshot.depthUsd.find((d) => d.pct === 2)
  if (!two || two.upUsd === null || two.downUsd === null || two.downUsd <= 0 || two.upUsd <= 0)
    return null
  const diff = Math.round(Math.abs(two.upUsd / two.downUsd - 1) * 100)
  if (diff === 0) return `Buying and selling meet the same depth at ±2${NB}%.`
  return two.upUsd >= two.downUsd
    ? `Buying meets ${diff}${NB}% more depth than selling at ±2${NB}%.`
    : `Selling meets ${Math.round(Math.abs(two.downUsd / two.upUsd - 1) * 100)}${NB}% more depth than buying at ±2${NB}%.`
}
