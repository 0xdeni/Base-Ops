/**
 * Data and geometry of the mirrored depth curve (CH3 and C9, docs/design/visual-v3.md §5.9):
 * the measured ±1/2/5 % levels of one snapshot, read as stored (never extrapolated past ±5 %), on a
 * log-spaced x and a linear y from 0. Pure, so the geometry is testable without layout.
 */
import type { PoolSnapshotDto } from '../../api/types.js'
import { amount, DASH, NB, pct, usd } from '../../lib/format.js'
import { linear, logPctX, niceTop, ticks } from '../../lib/scale.js'

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

/**
 * The measured points of a snapshot, left to right. A level whose side has no USD price is left
 * out (a missing level shows a sentence instead of a shape).
 */
export function curvePoints(snapshot: PoolSnapshotDto, token0: Token, token1: Token): CurvePoint[] {
  const out: CurvePoint[] = []
  for (const row of snapshot.depthUsd) {
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
  top: number
  base: number
  cx: number
  fx: (pct: number) => number
  fy: (usd: number) => number
  /** The y axis top: the nice tick at or above the deepest point. */
  ytop: number
  yTicks: number[]
  /** Spine first, then outward, per side. */
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
  const H = phone ? 240 : 340
  const top = 36
  const base = H - 30
  const cx = W / 2
  const half = W / 2 - 4
  const fx = (p: number) => logPctX(p, cx, half)
  const ytop = niceTop(Math.max(0, ...points.map((p) => p.usd)), 3)
  const fy = linear(0, ytop, base, top)
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
    ytop,
    yTicks: ticks(0, ytop, 3).filter((v) => v > 0),
    sell: path('sell'),
    buy: path('buy'),
    exhausted: { sell: firstOut('sell'), buy: firstOut('buy') },
  }
}

/** The x of a tick label, clamped 14 px inside the edges. */
export function clampTickX(x: number, W: number): number {
  return Math.min(W - 14, Math.max(14, x))
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

/** The figure's accessible summary, level by level. */
export function curveLabel(points: readonly CurvePoint[]): string {
  const side = (s: 'sell' | 'buy') =>
    points
      .filter((p) => p.side === s)
      .sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct))
      .map((p) => `${usd(p.usd)} to move ${pct(p.pct)}${p.reached ? '' : ' (liquidity runs out)'}`)
      .join(', ')
  return `Depth curve. Sell side: ${side('sell') || 'no USD price'}. Buy side: ${side('buy') || 'no USD price'}. Use the arrow keys to inspect each level.`
}

/** One point in words, for the live region while stepping with the keyboard. */
export function pointText(p: CurvePoint): string {
  const verb = p.side === 'buy' ? 'spent' : 'sold'
  const traded = p.amount === DASH ? '' : `, ${p.amount} ${verb}`
  return `${pct(p.pct)}, ${p.side} side: ${usd(p.usd)}${traded}, ${p.reached ? 'reached' : 'liquidity runs out'}`
}

/**
 * The Show data takeaway (visual-v3.md §5.9): "Buying meets 19 % more depth than selling at ±2 %." Null
 * when a side is unpriced at ±2 %.
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
