/**
 * The Pools explorer's URL state (ia-v3 §2, docs/design/visual-v3.md §6.2, §7 "URL state"): `q`,
 * `sort`, `dir`, `dex`, `cols`, `page`, `rated` (only the rated pools) and `unrated` (pages of
 * unrated pools opened behind "Show N unrated pools"). Defaults are left out of the URL and every change
 * replaces the entry instead of pushing one. v2 links keep their meaning (`?sort=depth&dir=asc`,
 * `?dex=aerodrome-v2`, `?q=weth`). The sort keys, columns and order are the shared pools table's
 * (lib/poolsTable.ts); a page-side sort (spread, top LP share) orders the API's page of 200.
 */
import { DEXES, type Dex } from '@depthwatch/core'
import type { SortDir } from '../../api/types.js'
import {
  colsParam,
  defaultDir,
  type OptionalColumn,
  type PoolsSortKey,
  readTableState,
} from '../../lib/poolsTable.js'

export interface PoolsState {
  q: string
  sort: PoolsSortKey
  dir: SortDir
  dex: Dex | ''
  cols: OptionalColumn[]
  /** Pages of 50 shown (TB8), from 1. */
  page: number
  /** "Rated only": the pools with no grade are not offered at all. */
  ratedOnly: boolean
  /** Pages of 50 unrated pools shown after the rated ones; 0 keeps them behind "Show N unrated pools". */
  unrated: number
}

export const PAGE_SIZE = 50
/** The API's largest page: the rows a page-side sort (spread, top LP share) orders. */
export const CLIENT_SORT_LIMIT = 200
export const DEFAULT_SORT: PoolsSortKey = 'health'

export function readPoolsState(params: URLSearchParams): PoolsState {
  const rawDex = params.get('dex') ?? ''
  const dex = (DEXES as readonly string[]).includes(rawDex) ? (rawDex as Dex) : ''
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const unrated = Number.parseInt(params.get('unrated') ?? '', 10)
  const ratedOnly = params.get('rated') === '1'
  return {
    q: params.get('q') ?? '',
    ...readTableState(params, DEFAULT_SORT),
    dex,
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 100) : 1,
    ratedOnly,
    unrated: !ratedOnly && Number.isFinite(unrated) && unrated > 0 ? Math.min(unrated, 100) : 0,
  }
}

/** `params` with `patch` applied, defaults left out; a new query, filter or order resets the page. */
export function writePoolsState(
  params: URLSearchParams,
  patch: Partial<PoolsState>,
): URLSearchParams {
  const cur = readPoolsState(params)
  const next: PoolsState = { ...cur, ...patch }
  const reorders = ['q', 'sort', 'dir', 'dex', 'ratedOnly'].some((k) => k in patch)
  if (patch.page === undefined && reorders) next.page = 1
  // A new order or filter keeps the unrated pools open, from their first page; "Rated only"
  // closes them.
  if (patch.unrated === undefined && reorders) next.unrated = Math.min(next.unrated, 1)
  if (next.ratedOnly) next.unrated = 0
  const out = new URLSearchParams(params)
  const put = (key: string, value: string, fallback = '') => {
    if (value && value !== fallback) out.set(key, value)
    else out.delete(key)
  }
  put('q', next.q)
  put('sort', next.sort, DEFAULT_SORT)
  put('dir', next.dir, defaultDir(next.sort))
  put('dex', next.dex)
  put('cols', colsParam(next.cols))
  put('page', next.page > 1 ? String(next.page) : '')
  put('rated', next.ratedOnly ? '1' : '')
  put('unrated', next.unrated > 0 ? String(next.unrated) : '')
  return out
}
