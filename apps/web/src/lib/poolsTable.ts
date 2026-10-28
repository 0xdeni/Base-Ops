/**
 * The pools table's model, shared by Pools and Token (docs/design/visual-v4.md §5.8, TB4, TB6,
 * TB7): the sort keys and their labels, the optional columns, the order (nulls last in both
 * directions), the `sort` / `dir` / `cols` URL state, and the reason an unknown value gives (D6).
 *
 * The API sorts by health, depth, volume, gap and TVL. Spread at $10K and top LP share are sorted
 * on the page over the rows it loaded; both must be sortable because on phones the row's value is
 * the sort metric (TB7). Formatting only: every value is the API's.
 */
import type { PoolSort, PoolSummary, SortDir } from '../api/types.js'
import { ago, dated, NB, SNAPSHOT_CLOCK } from './format.js'
import { sortSummaries } from './sort.js'

export type PoolsSortKey = PoolSort | 'spread' | 'top'
export type OptionalColumn = 'tvl' | 'gap' | 'top' | 'price' | 'updated'

/** Header and sort-sheet labels, in the sheet's order. */
export const SORT_LABEL: Readonly<Record<PoolsSortKey, string>> = {
  health: 'Health',
  depth: `Depth ±2${NB}%`,
  spread: 'Spread at $10K',
  volume: `24${NB}h volume`,
  gap: 'Gap score',
  tvl: 'TVL',
  top: 'Top LP share',
}
export const SORT_KEYS = Object.keys(SORT_LABEL) as PoolsSortKey[]

/** The sort as the phone button says it: "Sort: health", "Sort: top LP". */
export const SORT_SHORT: Readonly<Record<PoolsSortKey, string>> = {
  health: 'health',
  depth: 'depth',
  spread: 'spread',
  volume: 'volume',
  gap: 'gap score',
  tvl: 'TVL',
  top: 'top LP',
}

/** The optional columns, in the Columns popover's order. */
export const OPTIONAL_COLUMNS: ReadonlyArray<{ key: OptionalColumn; label: string }> = [
  { key: 'tvl', label: 'TVL' },
  { key: 'gap', label: 'Gap score' },
  { key: 'top', label: 'Top LP share' },
  { key: 'price', label: 'Price' },
  { key: 'updated', label: 'Updated' },
]

const API_SORTS: ReadonlySet<string> = new Set<PoolSort>([
  'health',
  'depth',
  'volume',
  'gap',
  'tvl',
])

/** Lower is better for spread, so its first click sorts ascending; every other metric descends. */
export function defaultDir(key: PoolsSortKey): SortDir {
  return key === 'spread' ? 'asc' : 'desc'
}

/** True when the API orders by `key`; otherwise the page orders the rows it loaded. */
export function isApiSort(key: PoolsSortKey): key is PoolSort {
  return API_SORTS.has(key)
}

export interface TableState {
  sort: PoolsSortKey
  dir: SortDir
  cols: OptionalColumn[]
}

/** A header click: the same column flips its direction, a new one starts at its default. */
export function nextSort(
  cur: Pick<TableState, 'sort' | 'dir'>,
  key: PoolsSortKey,
): Pick<TableState, 'sort' | 'dir'> {
  if (key === cur.sort) return { sort: key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
  return { sort: key, dir: defaultDir(key) }
}

/** `sort`, `dir` and `cols` from the URL; unknown values fall back to the defaults. */
export function readTableState(params: URLSearchParams, defaultSort: PoolsSortKey): TableState {
  const raw = params.get('sort') ?? ''
  const sort = (SORT_KEYS as readonly string[]).includes(raw) ? (raw as PoolsSortKey) : defaultSort
  const d = params.get('dir')
  const dir: SortDir = d === 'asc' || d === 'desc' ? d : defaultDir(sort)
  const known = new Set<string>(OPTIONAL_COLUMNS.map((c) => c.key))
  const cols = (params.get('cols') ?? '')
    .split(',')
    .filter((c): c is OptionalColumn => known.has(c))
  return { sort, dir, cols: [...new Set(cols)] }
}

/** The `cols` value: the chosen columns in the popover's order, or '' for none. */
export function colsParam(cols: readonly OptionalColumn[]): string {
  return OPTIONAL_COLUMNS.map((c) => c.key)
    .filter((k) => cols.includes(k))
    .join(',')
}

export function sortValue(p: PoolSummary, key: PoolsSortKey): number | null {
  switch (key) {
    case 'health':
      return p.health.total
    case 'depth':
      return p.depth2Usd
    case 'spread':
      return p.spread10kBps
    case 'volume':
      return p.volume24hUsd
    case 'gap':
      return p.gapScore
    case 'tvl':
      return p.tvlUsd
    case 'top':
      return p.ownerTop1Share
  }
}

/**
 * A stable sort with nulls last in both directions (TB4). Sorting by health also puts the unrated
 * pools after the rated ones in both directions, like the API.
 */
export function sortPools(
  items: readonly PoolSummary[],
  key: PoolsSortKey,
  dir: SortDir,
): PoolSummary[] {
  if (isApiSort(key)) return sortSummaries(items, key, dir)
  const sign = dir === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index, v: sortValue(item, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index
      if (a.v === null) return 1
      if (b.v === null) return -1
      return a.v === b.v ? a.index - b.index : (a.v - b.v) * sign
    })
    .map((e) => e.item)
}

/** The shared scale of the row depth glyphs: the largest side of any row (CH8). */
export function glyphMax(pools: readonly PoolSummary[]): number {
  return Math.max(0, ...pools.flatMap((p) => [p.depth2DownUsd ?? 0, p.depth2UpUsd ?? 0]))
}

/**
 * The caption's freshness (TB6): one value repeated on every row becomes "All pools updated 2 min
 * ago"; otherwise the oldest and newest, and the per-row values sit in the Updated column. On a
 * published snapshot the time carries its year ("All pools updated 25 Oct 2026, 11:30 UTC").
 */
export function updatedCaption(pools: readonly PoolSummary[], now: number): string {
  const times = pools.map((p) => p.updatedAt).filter((t): t is number => t !== null)
  if (!times.length) return ''
  const at = (ts: number) => (now === SNAPSHOT_CLOCK ? dated(ts) : ago(ts, now))
  const oldest = at(Math.min(...times))
  const newest = at(Math.max(...times))
  if (oldest === newest) return `All pools updated ${newest}`
  return `Updated ${oldest} to ${newest}`
}

/** Why a value is "—" (D6), worded per column. */
export const UNKNOWN_REASON = {
  depth: 'Depth is unknown: a token in this pool has no USD price.',
  spread: 'No spread: a token in this pool has no USD price.',
  volume: `No 24${NB}h volume is measured for this pool yet.`,
  gap: 'No gap score: the 24 h volume or the depth is unknown.',
  top: 'Owners are not indexed for this pool kind.',
  price: 'No snapshot of this pool yet.',
  updated: 'This pool has not been snapshotted yet.',
} as const

/** Why a pool's TVL is unknown: v4 pools share one contract; otherwise a token has no price. */
export function tvlReason(dex: string): string {
  return dex === 'uniswap-v4'
    ? 'Uniswap v4 pools share one singleton contract, so pool TVL is not reported.'
    : 'TVL is unknown: a token in this pool has no USD price.'
}
