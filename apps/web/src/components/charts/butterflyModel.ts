/**
 * Geometry of the depth butterfly (CH4, docs/design/visual-v3.md §5.9), kept pure so
 * it is testable without layout. Every width is a fraction of one shared linear scale whose maximum
 * is the larger total side, so a $31.5K pool is a hairline next to Base itself. The "All of …"
 * total row stacks the listed pools outward from the spine in row order, then one stratum for every
 * pool not listed. A side is null when its token has no USD price; it draws as nothing and reads
 * "—", never as 0.
 */
import type { PoolSummary } from '../../api/types.js'
import { dexLabel, NB, pairLabel, shareOf, usd, usdTick } from '../../lib/format.js'
import { ticks } from '../../lib/scale.js'

/** The DEX under the pair in the centre column (Slipstream is long enough on its own). */
export const DEX_SHORT: Readonly<Record<string, string>> = {
  'uniswap-v3': 'Uniswap v3',
  'uniswap-v4': 'Uniswap v4',
  'aerodrome-v2': 'Aerodrome v2',
  'aerodrome-slipstream': 'Slipstream',
}

export const dexShort = (dex: string): string => DEX_SHORT[dex] ?? dexLabel(dex)

/** At most this many rows (CH4): the 7 deepest plus the largest gap. */
export const BUTTERFLY_ROWS = 8

/**
 * The rows of a butterfly: the 7 deepest pools by ±2 % depth, plus the gap pool when it is not
 * among them (ia-v3 §4.1), deepest first.
 */
export function pickButterflyRows(
  pools: readonly PoolSummary[],
  gapPoolId?: string | null,
): PoolSummary[] {
  const byDepth = [...pools].sort((a, b) => (b.depth2Usd ?? -1) - (a.depth2Usd ?? -1))
  const rows = byDepth.slice(0, BUTTERFLY_ROWS - 1)
  if (gapPoolId && !rows.some((p) => p.pool.id === gapPoolId)) {
    const gap = pools.find((p) => p.pool.id === gapPoolId)
    if (gap) rows.push(gap)
  }
  return rows
}

export interface ButterflyRow {
  id: string
  pair: string
  dex: string
  dexShort: string
  /** USD per side within 2 %; null when that side is unpriced. */
  sell: number | null
  buy: number | null
  /** Fractions of the shared scale. */
  sellW: number
  buyW: number
  /** This pool's share of the scope's two-sided depth. */
  share: number
}

/** One pool's slice of a total side: offset from the spine and width, as scale fractions. */
export interface Stratum {
  o: number
  w: number
}

export interface ButterflyModel {
  rows: ButterflyRow[]
  total: { sell: number; buy: number }
  /** The shared scale's maximum: the larger total side. 0 when nothing is priced. */
  max: number
  /** Nice ticks on each side, mirrored around the spine. */
  ticks: number[]
  /** Per listed row (same index), then the "other pools" stratum when there is one. */
  strata: { sell: Stratum[]; buy: Stratum[] }
  /** The number of pools in scope (the total row's caption). */
  poolCount: number
}

const sum = (xs: readonly (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0)

export function butterflyModel(
  rows: readonly PoolSummary[],
  all: readonly PoolSummary[],
): ButterflyModel {
  const listed = new Set(rows.map((p) => p.pool.id))
  const rest = all.filter((p) => !listed.has(p.pool.id))
  const total = {
    sell: sum(rows.map((p) => p.depth2DownUsd)) + sum(rest.map((p) => p.depth2DownUsd)),
    buy: sum(rows.map((p) => p.depth2UpUsd)) + sum(rest.map((p) => p.depth2UpUsd)),
  }
  const max = Math.max(total.sell, total.buy)
  const frac = (v: number | null) => (max > 0 && v !== null ? Math.max(0, v) / max : 0)
  const both = total.sell + total.buy
  const strata = (key: 'depth2DownUsd' | 'depth2UpUsd'): Stratum[] => {
    let o = 0
    const out = rows.map((p) => {
      const w = frac(p[key])
      const s = { o, w }
      o += w
      return s
    })
    if (rest.length) out.push({ o, w: frac(sum(rest.map((p) => p[key]))) })
    return out
  }
  return {
    rows: rows.map((p) => ({
      id: p.pool.id,
      pair: pairLabel(p.pool.token0, p.pool.token1),
      dex: dexLabel(p.pool.dex),
      dexShort: dexShort(p.pool.dex),
      sell: p.depth2DownUsd,
      buy: p.depth2UpUsd,
      sellW: frac(p.depth2DownUsd),
      buyW: frac(p.depth2UpUsd),
      share: both > 0 ? ((p.depth2DownUsd ?? 0) + (p.depth2UpUsd ?? 0)) / both : 0,
    })),
    total,
    max,
    ticks: max > 0 ? ticks(0, max, 3).filter((v) => v > 0 && v <= max) : [],
    strata: { sell: strata('depth2DownUsd'), buy: strata('depth2UpUsd') },
    poolCount: all.length,
  }
}

/**
 * A Gap marker is 8 px offset, a 44 px leader, 6 px and "Gap": about 80 px, more than the 64 px
 * value lane (52 on phones). On a row whose buy bar reaches past this share of the scale (the gap
 * pool is the deepest, as on AERO's page) the marker would run past the content edge, so it takes
 * a 12 px leader instead (8 + 12 + 6 + 22 = 48 px).
 */
export const GAP_TIGHT_SHARE = 0.85

/** True when a gap row's marker must take the short leader to stay in the value lane. */
export function gapMarkerTight(buyW: number): boolean {
  return buyW > GAP_TIGHT_SHARE
}

/** A caption tick's width: 12 px tabular figures run about 7 px a glyph ("$10M" ≈ 28 px). */
const tickWidth = (v: number) => usdTick(v).length * 7

/**
 * The axis ticks a side can show on a `trackPx`-wide track: the outermost nice tick first, then
 * each inner one only when its label stays `gap` px clear of the one kept before it and of the
 * spine (the other side mirrors it). At 320 px "$10M  $5M" would read as one string; it shows
 * "$10M" alone.
 */
export function axisTicks(
  values: readonly number[],
  max: number,
  trackPx: number,
  gap = 12,
): number[] {
  if (!(max > 0) || !(trackPx > 0)) return []
  const at = (v: number) => (v / max) * trackPx
  const kept: number[] = []
  for (const v of [...values].sort((a, b) => b - a)) {
    if (at(v) - tickWidth(v) / 2 < gap / 2) continue
    const prev = kept[kept.length - 1]
    if (prev !== undefined && at(prev) - at(v) - (tickWidth(prev) + tickWidth(v)) / 2 < gap)
      continue
    kept.push(v)
  }
  return kept.reverse()
}

/**
 * Offsets of the canvas gaps between strata (§3.7): one at each cumulative boundary, skipped when
 * the stratum before it is under 3 px on a `trackPx`-wide side or the one after it is empty.
 */
export function strataBoundaries(strata: readonly Stratum[], trackPx: number): number[] {
  const out: number[] = []
  for (let i = 1; i < strata.length; i++) {
    const before = strata[i - 1]
    const s = strata[i]
    if (!before || !s) continue
    if (before.w * trackPx >= 3 && s.w > 0) out.push(s.o)
  }
  return out
}

/** The figure's accessible summary: the scope's totals, then every pool with both sides. */
export function butterflyLabel(model: ButterflyModel, scope: string): string {
  const head = `${scope}: ${usd(model.total.sell)} on the sell side and ${usd(model.total.buy)} on the buy side within 2${NB}% of the price.`
  if (!model.rows.length) return head
  const pools = model.rows
    .map((r) => `${r.pair} on ${r.dex}, ${usd(r.sell)} sell side, ${usd(r.buy)} buy side`)
    .join('; ')
  return `${head} By pool: ${pools}.`
}

/** A pair link's accessible name: both sides and the share of the scope. */
export function rowLinkLabel(row: ButterflyRow, scope: string): string {
  return `${row.pair}, ${row.dex}: ${usd(row.sell)} sell side, ${usd(row.buy)} buy side, ${shareOf(row.share)} of ${scope}’s depth`
}
