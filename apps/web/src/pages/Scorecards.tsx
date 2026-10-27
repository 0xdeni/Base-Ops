/**
 * Scorecards (`/mm`, ia-v3 §4.5, docs/design/visual-v3.md §6.5): "Which market makers are meeting
 * their mandates?" The h1, the answer ("1 of 2 mandates is within its KPIs right now.") and one
 * lead sentence; then the filter (All / Active / Inactive, `?active=`) and the List / Table view
 * (`?view=`), both segmented controls written to the URL with replace; then the ruled list of
 * mandate rows, or the table with every v2 column (L2).
 */
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDataNow, useSnapshot } from '../api/context.js'
import { usePoolMetas, useScorecards } from '../api/hooks.js'
import type { ScorecardsQuery } from '../api/types.js'
import { Button } from '../components/ui/Button.js'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import {
  EmptyState,
  Refetch,
  SectionError,
  Skeleton,
  SkeletonGroup,
  useDelayedPending,
} from '../components/ui/States.js'
import { count, NB } from '../lib/format.js'
import { useIsPhone } from '../lib/useMediaQuery.js'
import { MandateRows, STRIP_LIMIT } from './mm/MandateRows.js'
import { MandatesTable } from './mm/MandatesTable.js'
import { listAnswer } from './mm/mmText.js'
import './mm/mm.css'

type ActiveFilter = 'all' | 'active' | 'inactive'
type View = 'list' | 'table'

const FILTERS: ReadonlyArray<{ value: ActiveFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'list', label: 'List' },
  { value: 'table', label: 'Table' },
]

/** `?active=true|false` → the filter; anything else means all (v2's parameter, unchanged). */
export function readFilter(value: string | null): ActiveFilter {
  if (value === 'true') return 'active'
  if (value === 'false') return 'inactive'
  return 'all'
}

function toQuery(filter: ActiveFilter): ScorecardsQuery {
  if (filter === 'all') return {}
  return { active: filter === 'active' }
}

export function Scorecards() {
  const [params, setParams] = useSearchParams()
  const filter = readFilter(params.get('active'))
  const view: View = params.get('view') === 'table' ? 'table' : 'list'
  const all = useScorecards({})
  const shown = useScorecards(toQuery(filter))
  const items = shown.data?.items
  const pools = usePoolMetas(items?.map((s) => s.mandate.poolId) ?? [])
  const phone = useIsPhone()
  const now = useDataNow()
  const snapshot = useSnapshot()
  const waiting = useDelayedPending(all.isPending || shown.isPending)
  const total = all.data?.items.length

  const write = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === null) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  const setFilter = (f: ActiveFilter) =>
    write('active', f === 'all' ? null : f === 'active' ? 'true' : 'false')

  let body: ReactNode
  if (all.isError || shown.isError) {
    body = (
      <SectionError
        what="scorecards"
        onRetry={() => {
          void all.refetch()
          void shown.refetch()
        }}
      />
    )
  } else if (!items || total === undefined) {
    body = waiting ? (
      <SkeletonGroup label="Loading scorecards">
        {[0, 1].map((i) => (
          <Skeleton key={i} height={64} />
        ))}
      </SkeletonGroup>
    ) : null
  } else if (total === 0) {
    body = (
      <EmptyState
        action={
          <Link className="plink" to="/methodology#scorecards">
            How scorecards work
          </Link>
        }
      >
        {snapshot ? (
          'This snapshot holds no market-maker mandates.'
        ) : (
          <>
            Mandates are added with <code className="mono">depthwatch mm register</code> or{' '}
            <code className="mono">POST /api/mm</code>.
          </>
        )}
      </EmptyState>
    )
  } else if (!items.length) {
    body = (
      <EmptyState action={<Button onClick={() => setFilter('all')}>Show all mandates</Button>}>
        No {filter === 'inactive' ? 'inactive' : 'active'} mandates.
      </EmptyState>
    )
  } else {
    body = (
      <Refetch busy={shown.isFetching && shown.isPlaceholderData}>
        {view === 'table' ? (
          <MandatesTable items={items} pools={pools} now={now} />
        ) : (
          <MandateRows items={items} pools={pools} strips={!phone && items.length <= STRIP_LIMIT} />
        )}
      </Refetch>
    )
  }

  const caption =
    items && total !== undefined
      ? items.length === total
        ? `${count(total)} ${total === 1 ? 'mandate' : 'mandates'}`
        : `Showing ${count(items.length)} of ${count(total)} mandates`
      : ''

  return (
    <div className="wrap page mml">
      <title>Scorecards – Depthwatch</title>
      <div className="title-block">
        <h1 className="h1">Market-maker scorecards</h1>
      </div>
      <p className="answer answer-block">{all.data ? listAnswer(all.data.items) : NB}</p>
      <p className="lead mml-lead">
        A scorecard checks the depth a market maker promised against what is on chain at every
        snapshot.
      </p>
      {total === 0 ? null : (
        <>
          <div className="mml-controls">
            <SegmentedControl
              label="Mandates"
              options={FILTERS}
              value={filter}
              onChange={(f) => setFilter(f)}
            />
            <SegmentedControl
              label="View"
              className="mml-view"
              options={VIEWS}
              value={view}
              onChange={(v) => write('view', v === 'list' ? null : v)}
            />
          </div>
          <p className="tbl-caption mml-caption" aria-live="polite">
            {caption}
          </p>
        </>
      )}
      {body}
    </div>
  )
}
