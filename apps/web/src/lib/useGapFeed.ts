/**
 * The whole gaps feed at its default floor. `GET /api/gaps` pages at 200 and counts the whole
 * feed (`total`, `meaningful`), so the Gaps list and table read every page, in parallel once the
 * first one has said how many there are: a full index lists every gap, not the first page of them.
 * The first page is the one Home and the pool page read for their counts, so they share its cache.
 */
import { useQueries } from '@tanstack/react-query'
import { useApi } from '../api/context.js'
import { useGaps } from '../api/hooks.js'
import type { GapItem, GapsQuery, GapsResponse } from '../api/types.js'

/** The API's largest page, the first of which Home and the pool page read too. */
export const GAP_FEED_PAGE = 200
export const GAP_FEED: GapsQuery = { limit: GAP_FEED_PAGE }

export interface GapFeed {
  /** The first page: the feed's counts and floor (`total`, `meaningful`, `minVolumeUsd`). */
  data: GapsResponse | undefined
  /** Every row of the feed once all pages are in; undefined while any page is loading. */
  items: GapItem[] | undefined
  isPending: boolean
  isError: boolean
  refetch: () => void
}

export function useGapFeed(): GapFeed {
  const api = useApi()
  const first = useGaps(GAP_FEED)
  const total = first.data?.total
  const offsets: number[] = []
  if (total !== undefined)
    for (let offset = GAP_FEED_PAGE; offset < total; offset += GAP_FEED_PAGE) offsets.push(offset)
  const rest = useQueries({
    queries: offsets.map((offset) => {
      const query: GapsQuery = { ...GAP_FEED, offset }
      return { queryKey: ['gaps', query], queryFn: () => api.gaps(query) }
    }),
  })
  const restPending = rest.some((q) => q.isPending)
  const restError = rest.some((q) => q.isError)
  const items =
    first.data && !restPending && !restError
      ? [...first.data.items, ...rest.flatMap((q) => q.data?.items ?? [])]
      : undefined
  return {
    data: first.data,
    items,
    isPending: first.isPending || restPending,
    isError: first.isError || restError,
    refetch: () => {
      void first.refetch()
      for (const q of rest) if (q.isError) void q.refetch()
    },
  }
}
