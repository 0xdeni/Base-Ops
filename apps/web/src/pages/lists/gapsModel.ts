/**
 * The Gaps screen's sentences and URL state (ia-v3 §2, §4.4, docs/design/visual-v4.md §6.5).
 * `view` is `list` (default) or `table`; the table's `sort` and `dir` sit beside it, and `rows=all`
 * shows every meaningful gap instead of the first 20; defaults left out, replaced not pushed. A
 * meaningful gap trades 3× its ±2 % depth a day or more (TB9), the threshold every screen uses;
 * the numbers come from the API (core's `computeGap`).
 */
import type { GapItem, SortDir } from '../../api/types.js'
import { MEANINGFUL_GAP_TURNOVER } from '../../components/charts/TurnoverGlyph.js'
import { NB, ratio, usd } from '../../lib/format.js'

export type GapsView = 'list' | 'table'
export type GapsSortKey = 'volume' | 'depth' | 'turnover' | 'gap' | 'health' | 'tvl'

export interface GapsState {
  view: GapsView
  sort: GapsSortKey
  dir: SortDir
  /** `rows=all`: every meaningful gap in the list, not the first 20. */
  allRows: boolean
}

/** Meaningful gaps the list shows before "Show all 48" (§6.5). */
export const GAP_PAGE = 20

export const GAPS_DEFAULT_SORT: GapsSortKey = 'turnover'

export const GAPS_SORT_LABEL: Readonly<Record<GapsSortKey, string>> = {
  volume: `24${NB}h volume`,
  depth: `Depth ±2${NB}%`,
  turnover: 'Turnover',
  gap: 'Gap score',
  health: 'Health',
  tvl: 'TVL',
}
const SORT_KEYS = Object.keys(GAPS_SORT_LABEL) as GapsSortKey[]

export function readGapsState(params: URLSearchParams): GapsState {
  const view: GapsView = params.get('view') === 'table' ? 'table' : 'list'
  const raw = params.get('sort') ?? ''
  const sort = (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as GapsSortKey)
    : GAPS_DEFAULT_SORT
  const dir: SortDir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  return { view, sort, dir, allRows: params.get('rows') === 'all' }
}

/**
 * `params` with `patch` applied; the table's order only travels with the table view, and `rows`
 * only with the list.
 */
export function writeGapsState(
  params: URLSearchParams,
  patch: Partial<GapsState>,
): URLSearchParams {
  const next = { ...readGapsState(params), ...patch }
  const out = new URLSearchParams(params)
  const table = next.view === 'table'
  if (table) out.set('view', 'table')
  else out.delete('view')
  if (table && next.sort !== GAPS_DEFAULT_SORT) out.set('sort', next.sort)
  else out.delete('sort')
  if (table && next.dir !== 'desc') out.set('dir', next.dir)
  else out.delete('dir')
  if (!table && next.allRows) out.set('rows', 'all')
  else out.delete('rows')
  return out
}

export function isMeaningful(g: GapItem): boolean {
  return (g.gap.turnoverRatio ?? 0) >= MEANINGFUL_GAP_TURNOVER
}

/** "1 pool trades 3× its depth or more every day." (or "No pool trades 3× its depth today."). */
export function gapsAnswer(meaningful: number): string {
  if (meaningful === 0) return `No pool trades ${MEANINGFUL_GAP_TURNOVER}× its depth today.`
  return meaningful === 1
    ? `1 pool trades ${MEANINGFUL_GAP_TURNOVER}× its depth or more every day.`
    : `${meaningful} pools trade ${MEANINGFUL_GAP_TURNOVER}× their depth or more every day.`
}

/** The row's sentence: "Trades 51× its depth a day". */
export function tradesSentence(g: GapItem): string {
  return `Trades ${ratio(g.gap.turnoverRatio)} its depth a day`
}

/** What the sentence summarises, on hover and focus: "$1.60M traded through $31.5K of depth". */
export function tradesDetail(g: GapItem): string {
  return `${usd(g.gap.volume24hUsd)} traded through ${usd(g.gap.depth2Usd)} of depth`
}

/** The list's foot while the quiet rows wait: "20 more pools trade less than 3× their depth." */
export function restSentence(n: number): string {
  return n === 1
    ? `1 more pool trades less than ${MEANINGFUL_GAP_TURNOVER}× its depth.`
    : `${n} more pools trade less than ${MEANINGFUL_GAP_TURNOVER}× their depth.`
}

/** The quiet rows' disclosure: "Show 5 more pools that trade less than 3× their depth". */
export function quietLabel(n: number): string {
  return n === 1
    ? `Show 1 more pool that trades less than ${MEANINGFUL_GAP_TURNOVER}× its depth`
    : `Show ${n} more pools that trade less than ${MEANINGFUL_GAP_TURNOVER}× their depth`
}

/** The same disclosure on phones, where the sentence would wrap: "Show 5 pools under 3×". */
export function quietShortLabel(n: number): string {
  return `Show ${n} ${n === 1 ? 'pool' : 'pools'} under ${MEANINGFUL_GAP_TURNOVER}×`
}

export function gapsSortValue(g: GapItem, key: GapsSortKey): number | null {
  switch (key) {
    case 'volume':
      return g.gap.volume24hUsd
    case 'depth':
      return g.gap.depth2Usd
    case 'turnover':
      return g.gap.turnoverRatio
    case 'gap':
      return g.gap.gapScore
    case 'health':
      return g.pool.health.total
    case 'tvl':
      return g.pool.tvlUsd
  }
}

/**
 * A stable sort with nulls last in both directions (TB4). Sorting by health also puts the pools
 * with no grade after the rated ones in both directions, like every other list: their totals are
 * not shown, only the "Not rated" chip, so they cannot be ordered among the graded ones.
 */
export function sortGaps(items: readonly GapItem[], key: GapsSortKey, dir: SortDir): GapItem[] {
  const sign = dir === 'asc' ? 1 : -1
  const unrated = (item: GapItem) => (key === 'health' && !item.pool.health.rated ? 1 : 0)
  return items
    .map((item, index) => ({ item, index, v: gapsSortValue(item, key), unrated: unrated(item) }))
    .sort((a, b) => {
      if (a.unrated !== b.unrated) return a.unrated - b.unrated
      if (a.v === null && b.v === null) return a.index - b.index
      if (a.v === null) return 1
      if (b.v === null) return -1
      return a.v === b.v ? a.index - b.index : (a.v - b.v) * sign
    })
    .map((e) => e.item)
}
