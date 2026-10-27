/**
 * The rows of the Pools table for the URL state: pages of 50 (TB8, `page`), each its own
 * `GET /api/pools` with an offset, so "Show more" never refetches what is on screen. A sort the
 * API does not know (spread, top LP share) reads one page of 200 ordered by health and sorts it
 * here. A parameter change keeps the old rows in place, marked busy, until the new ones arrive
 * (M10). The rated pools and the unrated ones are two lists (`rated=true` / `false`): the table
 * shows the rated ones, and the unrated ones follow them once the reader opens them.
 */
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { useApi } from '../../api/context.js'
import type { PoolSummary, PoolsQuery } from '../../api/types.js'
import { isApiSort, sortPools } from '../../lib/poolsTable.js'
import { CLIENT_SORT_LIMIT, PAGE_SIZE, type PoolsState } from './poolsState.js'

export interface PoolRows {
  rows: PoolSummary[] | undefined
  /** Scored pools matching the query, ignoring paging. */
  total: number | undefined
  /** Rows the reader can still reveal with "Show more". */
  remaining: number
  /** The page-side sort ran over the API's first 200 of more pools. */
  truncated: boolean
  isPending: boolean
  isError: boolean
  error: unknown
  /** Old rows on screen while new parameters load. */
  busy: boolean
  /** A further page is on its way. */
  loadingMore: boolean
  refetch: () => void
}

/** The `GET /api/pools` query of page `i` (from 0) of the rated or the unrated pools. */
export function poolsPageQuery(state: PoolsState, i: number, rated = true): PoolsQuery {
  const apiKey = isApiSort(state.sort) ? state.sort : null
  const server = apiKey !== null
  const size = server ? PAGE_SIZE : CLIENT_SORT_LIMIT
  return {
    sort: apiKey ?? 'health',
    dir: server ? state.dir : 'desc',
    dex: state.dex,
    q: state.q,
    rated,
    limit: size,
    offset: i * size,
  }
}

/** How many unrated pools match the filters: one row asked for, only its `total` read. */
export function useUnratedTotal(state: PoolsState, enabled: boolean): number | undefined {
  const api = useApi()
  const query: PoolsQuery = { ...poolsPageQuery(state, 0, false), limit: 1, offset: 0 }
  const count = useQuery({
    queryKey: ['pools', query],
    queryFn: () => api.pools(query),
    placeholderData: keepPreviousData,
    enabled,
  })
  return count.data?.total
}

export interface PoolRowsOptions {
  /** The rated pools (default) or the unrated ones. */
  rated?: boolean
  /** Pages of 50 to show (a page-side sort reads its one page of 200); default the URL's `page`. */
  pages?: number
  /** False keeps the hook idle (the unrated list while it is closed). */
  enabled?: boolean
}

export function usePoolRows(state: PoolsState, options: PoolRowsOptions = {}): PoolRows {
  const { rated = true, pages = state.page, enabled = true } = options
  const api = useApi()
  const server = isApiSort(state.sort)
  const pageQuery = (i: number): PoolsQuery => poolsPageQuery(state, i, rated)
  // The first page keeps its old rows while new parameters load (keepPreviousData); further pages
  // only ever extend it, since any new query, filter or order resets the page to 1.
  const first = useQuery({
    queryKey: ['pools', pageQuery(0)],
    queryFn: () => api.pools(pageQuery(0)),
    placeholderData: keepPreviousData,
    enabled,
  })
  const more = useQueries({
    queries: Array.from({ length: enabled && server ? Math.max(0, pages - 1) : 0 }, (_, i) => ({
      queryKey: ['pools', pageQuery(i + 1)],
      queryFn: () => api.pools(pageQuery(i + 1)),
    })),
  })
  const total = first.data?.total
  let rows: PoolSummary[] | undefined
  if (first.data) {
    const loaded = [...first.data.items]
    // Pages join in order: a later page waits for the ones before it.
    for (const r of more) {
      if (!r.data) break
      loaded.push(...r.data.items)
    }
    rows = server ? loaded : sortPools(loaded, state.sort, state.dir).slice(0, PAGE_SIZE * pages)
  }
  const reachable = server ? (total ?? 0) : Math.min(total ?? 0, CLIENT_SORT_LIMIT)
  const failed = [first, ...more].find((r) => r.isError)
  return {
    rows,
    total,
    remaining: rows ? Math.max(0, reachable - rows.length) : 0,
    truncated: !server && (total ?? 0) > CLIENT_SORT_LIMIT,
    isPending: enabled && first.isPending,
    isError: failed !== undefined,
    error: failed?.error ?? null,
    busy: first.isFetching && first.isPlaceholderData,
    loadingMore: more.some((r) => r.isPending),
    refetch: () => {
      for (const r of [first, ...more]) if (r.isError || !r.data) void r.refetch()
    },
  }
}
