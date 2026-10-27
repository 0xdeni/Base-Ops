/**
 * TanStack Query hooks, one per endpoint. Query keys are namespaced by endpoint and parameters.
 */
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { useApi } from './context.js'
import type {
  GapsQuery,
  HistoryWindow,
  PoolMetaDto,
  PoolsQuery,
  SampleWindow,
  ScorecardsQuery,
  TokenQuery,
} from './types.js'

const HEALTH_REFETCH_MS = 60_000

export function useHealth() {
  const api = useApi()
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: HEALTH_REFETCH_MS,
  })
}

export function useStats() {
  const api = useApi()
  return useQuery({ queryKey: ['stats'], queryFn: () => api.stats() })
}

export function usePools(query: PoolsQuery) {
  const api = useApi()
  return useQuery({
    queryKey: ['pools', query],
    queryFn: () => api.pools(query),
    placeholderData: keepPreviousData,
  })
}

export function usePool(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['pool', id],
    queryFn: () => api.pool(id),
    enabled: id.length > 0,
  })
}

/**
 * The observatory's metadata (pair, DEX, fee) of each pool in `ids`, by id: one `GET
 * /api/pools/:id` per distinct id, sharing the pool page's cache. Pools the observatory does not
 * know (404) or that are still loading are absent, so callers keep a fallback for them.
 */
export function usePoolMetas(ids: readonly string[]): ReadonlyMap<string, PoolMetaDto> {
  const api = useApi()
  const distinct = [...new Set(ids)].filter((id) => id.length > 0)
  return useQueries({
    queries: distinct.map((id) => ({
      queryKey: ['pool', id],
      queryFn: () => api.pool(id),
    })),
    combine: (results) => {
      const metas = new Map<string, PoolMetaDto>()
      for (const [i, result] of results.entries()) {
        const id = distinct[i]
        if (id !== undefined && result.data) metas.set(id, result.data.pool)
      }
      return metas
    },
  })
}

export function usePoolHistory(id: string, window: HistoryWindow) {
  const api = useApi()
  return useQuery({
    queryKey: ['pool', id, 'history', window],
    queryFn: () => api.history(id, window),
    enabled: id.length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useGaps(query: GapsQuery) {
  const api = useApi()
  return useQuery({ queryKey: ['gaps', query], queryFn: () => api.gaps(query) })
}

export function useToken(address: string, query: TokenQuery = {}) {
  const api = useApi()
  return useQuery({
    queryKey: ['token', address, query],
    queryFn: () => api.token(address, query),
    enabled: address.length > 0,
    placeholderData: keepPreviousData,
  })
}

/** `GET /api/mm`: every scorecard, active first then by name. */
export function useScorecards(query: ScorecardsQuery = {}) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', query],
    queryFn: () => api.scorecards(query),
    placeholderData: keepPreviousData,
  })
}

/** `GET /api/mm/:id`. */
export function useScorecard(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', id],
    queryFn: () => api.scorecard(id),
    enabled: id.length > 0,
  })
}

/** `GET /api/mm/:id/samples?window=`: the whole window (the API's default limit). */
export function useScorecardSamples(id: string, window: SampleWindow) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', id, 'samples', window],
    queryFn: () => api.scorecardSamples(id, { window }),
    enabled: id.length > 0,
    placeholderData: keepPreviousData,
  })
}

/** `GET /api/mm/:id/badge.svg` as text, for the embed preview. */
export function useBadge(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['mm', id, 'badge'],
    queryFn: () => api.badge(id),
    enabled: id.length > 0,
  })
}
