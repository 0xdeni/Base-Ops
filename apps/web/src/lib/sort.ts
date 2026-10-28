import type { PoolSort, PoolSummary, SortDir } from '../api/types.js'

/** The numeric value a sort key reads from a summary; null sorts last in either direction. */
export function sortValue(item: PoolSummary, sort: PoolSort): number | null {
  switch (sort) {
    case 'health':
      return item.health.total
    case 'depth':
      return item.depth2Usd
    case 'volume':
      return item.volume24hUsd
    case 'gap':
      return item.gapScore
    case 'tvl':
      return item.tvlUsd
    case 'spread':
      return item.spread10kBps
    case 'top':
      return item.ownerTop1Share
  }
}

/**
 * Stable sort of summaries (used by the mock client, the static client and client-side tables),
 * ordered like the API: nulls last in both directions; when sorting by health the unrated pools
 * come after every rated one, and when sorting by depth the stale quotes after the others, in both
 * directions, each group by its value.
 */
export function sortSummaries(
  items: readonly PoolSummary[],
  sort: PoolSort,
  dir: SortDir,
): PoolSummary[] {
  const sign = dir === 'asc' ? 1 : -1
  const last = (item: PoolSummary) =>
    (sort === 'health' && !item.health.rated) || (sort === 'depth' && item.staleQuote) ? 1 : 0
  return items
    .map((item, index) => ({ item, index, value: sortValue(item, sort), last: last(item) }))
    .sort((a, b) => {
      if (a.last !== b.last) return a.last - b.last
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      if (a.value !== b.value) return (a.value - b.value) * sign
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

/**
 * Case-insensitive substring match on the same fields as the API's `q` filter: token symbols,
 * token addresses, pool address or v4 pool id (plus the pair label). Token names are not
 * matched, so a query behaves the same against the mock and the live API.
 */
export function matchesQuery(item: PoolSummary, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const { pool } = item
  const haystack = [
    pool.id,
    pool.address ?? '',
    pool.poolId ?? '',
    pool.token0.symbol,
    pool.token0.address,
    pool.token1.symbol,
    pool.token1.address,
    `${pool.token0.symbol}/${pool.token1.symbol}`,
    `${pool.token0.symbol} / ${pool.token1.symbol}`,
  ]
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}
