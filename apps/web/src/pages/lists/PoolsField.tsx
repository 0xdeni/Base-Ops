/**
 * The focal element of `/pools` (docs/design/visual-v4.md §5.9.2, §6.3): the square field on the
 * right 7 / 12 of the band, one square per scored pool with depth, area true to that depth. It
 * reads every scored pool (`useAllPools`), shows its skeleton while they load and a section error
 * if they fail. While a DEX, a search or "Rated only" is set, the squares outside the table's list
 * dim, with the same matching the API applies (`matchesQuery`), so the field and the table agree.
 */
import { useMemo } from 'react'
import type { PoolSummary } from '../../api/types.js'
import { SquareField } from '../../components/charts/SquareField.js'
import { SectionError } from '../../components/ui/States.js'
import { matchesQuery } from '../../lib/sort.js'
import type { AllPools } from '../../lib/useAllPools.js'
import { FieldSkeleton } from './ListSkeleton.js'
import type { PoolsState } from './poolsState.js'

/** The table's filter as a test on one pool, or null when nothing is set. */
export function tableFilter(
  state: Pick<PoolsState, 'dex' | 'q' | 'ratedOnly'>,
): ((pool: PoolSummary) => boolean) | null {
  const q = state.q.trim()
  if (!state.dex && !q && !state.ratedOnly) return null
  return (p) =>
    (!state.dex || p.pool.dex === state.dex) &&
    matchesQuery(p, q) &&
    (!state.ratedOnly || p.health.rated)
}

export function PoolsField({
  field,
  state,
  waiting,
}: {
  field: AllPools
  state: Pick<PoolsState, 'dex' | 'q' | 'ratedOnly'>
  /** Loading for under 300 ms: the skeleton holds its space but stays invisible (M10). */
  waiting: boolean
}) {
  const { dex, q, ratedOnly } = state
  const inFilter = useMemo(() => tableFilter({ dex, q, ratedOnly }), [dex, q, ratedOnly])
  let body = null
  if (field.pools) {
    body = field.pools.length ? <SquareField pools={field.pools} inFilter={inFilter} /> : null
  } else if (field.isError) {
    body = <SectionError what="the square field" onRetry={field.refetch} />
  } else {
    body = <FieldSkeleton waiting={waiting} />
  }
  return <div className="lists-field">{body}</div>
}
