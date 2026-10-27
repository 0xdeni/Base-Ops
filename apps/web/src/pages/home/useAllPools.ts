/**
 * Every scored pool, deepest first: the butterfly's total row sums them all (CH4),
 * so Home reads the whole list, not just the listed rows. `GET /api/pools` pages at 200, so a
 * live world with more pools is read in pages; the first page is shared with any other screen
 * asking the same query.
 */
import { useQueries } from '@tanstack/react-query'
import { useApi } from '../../api/context.js'
import { usePools } from '../../api/hooks.js'
import type { PoolSummary, PoolsQuery } from '../../api/types.js'

/** The API's largest page. */
export const POOLS_PAGE = 200

const FIRST: PoolsQuery = { sort: 'depth', dir: 'desc', limit: POOLS_PAGE }

export interface AllPools {
  /** Every scored pool once all pages are in; undefined while any page is loading. */
  pools: PoolSummary[] | undefined
  /** Scored pools in total (the API's count, ignoring paging). */
  total: number | undefined
  isPending: boolean
  isError: boolean
  refetch: () => void
}

export function useAllPools(): AllPools {
  const api = useApi()
  const first = usePools(FIRST)
  const total = first.data?.total
  const offsets: number[] = []
  if (total !== undefined)
    for (let offset = POOLS_PAGE; offset < total; offset += POOLS_PAGE) offsets.push(offset)
  const rest = useQueries({
    queries: offsets.map((offset) => {
      const query: PoolsQuery = { ...FIRST, offset }
      return { queryKey: ['pools', query], queryFn: () => api.pools(query) }
    }),
  })
  const restPending = rest.some((q) => q.isPending)
  const restError = rest.some((q) => q.isError)
  const pools =
    first.data && !restPending && !restError
      ? [...first.data.items, ...rest.flatMap((q) => q.data?.items ?? [])]
      : undefined
  return {
    pools,
    total,
    isPending: first.isPending || restPending,
    isError: first.isError || restError,
    refetch: () => {
      void first.refetch()
      for (const q of rest) void q.refetch()
    },
  }
}
