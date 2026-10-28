/**
 * Geometry of the KPI chart (docs/design/visual-v4.md §5.9.4), pure: the latest sample's depth per
 * side against the mandate's per-side KPI, both halves on one scale `S = 1.25 × max(KPI, sell,
 * buy)`. A side below its KPI carries its shortfall, KPI minus value, drawn from the bar's end to
 * the KPI line; a side at or above it carries none. An unknown side (no USD price) draws nothing
 * and is not checkable.
 */
import { usd } from '../../lib/format.js'

export interface KpiSide {
  side: 'sell' | 'buy'
  value: number | null
  /** The bar and the KPI line as fractions of the half. */
  w: number
  kpiW: number
  /** True when the side is known and under its KPI. */
  below: boolean
  /** KPI minus value, only below the KPI; null otherwise. */
  shortfall: number | null
  /** The shortfall's width, from the bar's end to the KPI line. */
  shortW: number
}

export interface KpiModel {
  /** The scale's end: 1.25 × the larger of the KPI and the two sides. */
  S: number
  kpi: number
  sell: KpiSide
  buy: KpiSide
}

export function kpiModel(sell: number | null, buy: number | null, kpi: number): KpiModel {
  const S = 1.25 * Math.max(kpi, sell ?? 0, buy ?? 0)
  const f = (v: number) => (S > 0 ? Math.min(1, Math.max(0, v / S)) : 0)
  const side = (s: 'sell' | 'buy', value: number | null): KpiSide => {
    const below = value !== null && value < kpi
    const w = value === null ? 0 : f(value)
    return {
      side: s,
      value,
      w,
      kpiW: f(kpi),
      below,
      shortfall: below && value !== null ? kpi - value : null,
      shortW: below ? Math.max(0, f(kpi) - w) : 0,
    }
  }
  return { S, kpi, sell: side('sell', sell), buy: side('buy', buy) }
}

const word = (s: 'sell' | 'buy') => (s === 'sell' ? 'Sell side' : 'Buy side')

/** The label inside a bar: "Sell side, below KPI", "Buy side", "Sell side, not checkable". */
export function sideTitle(k: KpiSide): string {
  if (k.value === null) return `${word(k.side)}, not checkable`
  return k.below ? `${word(k.side)}, below KPI` : word(k.side)
}

/** "Sell side $386K, below the $400K KPI by $14.2K. Buy side $425K, within it." */
export function kpiLabel(m: KpiModel): string {
  const one = (k: KpiSide, first: boolean) => {
    if (k.value === null) return `${word(k.side)} has no USD price, so it cannot be checked.`
    const kpi = first ? `the ${usd(m.kpi)} KPI` : 'it'
    return k.below
      ? `${word(k.side)} ${usd(k.value)}, below ${kpi} by ${usd(k.shortfall)}.`
      : `${word(k.side)} ${usd(k.value)}, within ${kpi}.`
  }
  return `${one(m.sell, true)} ${one(m.buy, m.sell.value === null)}`
}

/** The caption beside the hatch swatch, or null when neither side falls short. */
export function shortfallText(m: KpiModel): string | null {
  const short = [m.sell, m.buy].filter((k) => k.shortfall !== null)
  const [only] = short
  if (!only) return null
  if (short.length === 1) return `Shortfall against the KPI: ${usd(only.shortfall)}`
  return `Shortfall against the KPI: ${usd(m.sell.shortfall)} on the sell side, ${usd(m.buy.shortfall)} on the buy side`
}

/**
 * Whether a side's words fit inside its bar on a `halfPx`-wide half: the 13 px title (about 7 px
 * a glyph) or the value at `valuePx` (about 0.56 em a glyph), 20 px from the spine (10 on phones)
 * and 12 px clear of the bar's end. A side that does not fit reads under the bars instead.
 */
export function wordsFit(k: KpiSide, halfPx: number, valuePx: number, phone: boolean): boolean {
  const title = phone ? (word(k.side).split(' ')[0] ?? '') : sideTitle(k)
  const need =
    Math.max(title.length * 7, usd(k.value).length * valuePx * 0.56) + (phone ? 10 : 20) + 12
  return k.w * halfPx >= need
}

/** The caption when the store keeps per-side depth for the latest sample only. */
export const KPI_NOTE = 'Per-side depth is stored for the latest snapshot only.'
