/**
 * The rows of the Pools table for the URL state: pages of 50 (TB8, `page`), each its own
 * `GET /api/pools` with an offset, so "Show more" never refetches what is on screen. Every sort
 * key, spread and top LP share included, is the API's, over all the matching pools. A parameter
 * change keeps the old rows in place, marked busy, until the new ones arrive (M10). The rated pools and the unrated ones are two lists (`rated=true` / `false`): the table
 * shows the rated ones, and the unrated ones follow them once the reader opens them.
 */
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { useApi } from '../../api/context.js'
import type { PoolSummary, PoolsQuery } from '../../api/types.js'
import { PAGE_SIZE, type PoolsState } from './poolsState.js'

export interface PoolRows {
  rows: PoolSummary[] | undefined
  /** Scored pools matching the query, ignoring paging. */
  total: number | undefined
  /** Rows the reader can still reveal with "Show more". */
  remaining: number
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
  return {
    sort: state.sort,
    dir: state.dir,
    dex: state.dex,
    q: state.q,
    rated,
    limit: PAGE_SIZE,
    offset: i * PAGE_SIZE,
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
  /** Pages of 50 to show; default the URL's `page`. */
  pages?: number
  /** False keeps the hook idle (the unrated list while it is closed). */
  enabled?: boolean
}

export function usePoolRows(state: PoolsState, options: PoolRowsOptions = {}): PoolRows {
  const { rated = true, pages = state.page, enabled = true } = options
  const api = useApi()
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
    queries: Array.from({ length: enabled ? Math.max(0, pages - 1) : 0 }, (_, i) => ({
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
    rows = loaded
  }
  const failed = [first, ...more].find((r) => r.isError)
  return {
    rows,
    total,
    remaining: rows ? Math.max(0, (total ?? 0) - rows.length) : 0,
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
