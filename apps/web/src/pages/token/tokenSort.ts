/**
 * The Token page's pools table state (ia-v3 §2, §4.7, docs/design/visual-v4.md §6.8): sort,
 * direction, optional columns and whether every pool is listed live in the URL (`sort`, `dir`,
 * `cols`, `rows=all`; defaults are omitted, the URL is replaced, not pushed). The
 * keys, columns and order are the shared pools table's (lib/poolsTable.ts); this page sorts by
 * depth by default. Every key goes to the API, which orders all of the token's pools, nulls last
 * in both directions (TB4).
 */
import type { TokenQuery } from '../../api/types.js'
import {
  colsParam,
  defaultDir,
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

/**
 * The API's largest page: the first pools of the token in the table's order. The answer and the
 * takeaway read the token's totals from the API, so they hold for every pool beyond it too.
 */
export const TOKEN_POOL_LIMIT = 200

/** The `GET /api/tokens/:address` query of the Token page for its URL state. */
export function tokenQuery(state: TableState): TokenQuery {
  return { sort: state.sort, dir: state.dir, limit: TOKEN_POOL_LIMIT }
}

/** The sheet lists this many pools until "Show all" (`rows=all`), so the page stays in budget. */
export const TOKEN_ROWS = 10

/** True when the URL asks for every pool (`rows=all`). */
export function readAllRows(params: URLSearchParams): boolean {
  return params.get('rows') === 'all'
}

/** Writes `rows=all`, or removes it, in a copy of `params`. */
export function writeAllRows(params: URLSearchParams, all: boolean): URLSearchParams {
  const next = new URLSearchParams(params)
  if (all) next.set('rows', 'all')
  else next.delete('rows')
  return next
}
