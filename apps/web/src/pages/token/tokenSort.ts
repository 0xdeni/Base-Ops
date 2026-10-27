/**
 * The Token page's pools table state (ia-v3 §2, §4.7): sort, direction and optional columns live
 * in the URL (`sort`, `dir`, `cols`; defaults are omitted, the URL is replaced, not pushed). The
 * keys, columns and order are the shared pools table's (lib/poolsTable.ts); this page sorts by
 * depth by default. Keys the API sorts by are sent to it; spread and top LP share sort the loaded
 * page, nulls last in both directions (TB4).
 */
import type { PoolSort, TokenQuery } from '../../api/types.js'
import {
  colsParam,
  defaultDir,
  isApiSort,
  type PoolsSortKey,
  readTableState as readShared,
  type TableState,
} from '../../lib/poolsTable.js'

export const DEFAULT_SORT: PoolsSortKey = 'depth'

export function readTableState(params: URLSearchParams): TableState {
  return readShared(params, DEFAULT_SORT)
}

/** Writes `state` into a copy of `params`, leaving defaults out. */
export function writeTableState(params: URLSearchParams, state: TableState): URLSearchParams {
  const next = new URLSearchParams(params)
  if (state.sort === DEFAULT_SORT) next.delete('sort')
  else next.set('sort', state.sort)
  if (state.dir === defaultDir(state.sort)) next.delete('dir')
  else next.set('dir', state.dir)
  const cols = colsParam(state.cols)
  if (cols) next.set('cols', cols)
  else next.delete('cols')
  return next
}

/** The API's own sort for `key`, or its default when only the page can sort by it. */
export function apiSort(key: PoolsSortKey): PoolSort {
  return isApiSort(key) ? key : 'depth'
}

/** The API pages a token's pools; one page of its maximum covers any token in practice. */
export const TOKEN_POOL_LIMIT = 200

/** The `GET /api/tokens/:address` query of the Token page for its URL state. */
export function tokenQuery(state: TableState): TokenQuery {
  return { sort: apiSort(state.sort), dir: state.dir, limit: TOKEN_POOL_LIMIT }
}
