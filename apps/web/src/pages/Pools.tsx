/**
 * `/pools` (ia-v3 §4.2, docs/design/visual-v3.md §6.2): find any pool and compare it with its
 * peers. The h1, a filter-aware answer ("6 pools on 4 DEXes hold $26.1M within 2 % of the price."),
 * the controls row, a caption, the ranked pools table (the focal element; the table is the facts),
 * "Show more" in pages of 50 and the "Compare DEXes" disclosure. The table lists the rated pools;
 * the unrated ones stay behind one quiet row, "Show 442 unrated pools", until the reader opens
 * them (TB9), or are left out with "Rated only". Search, sort, direction, DEX, rating, columns and
 * pages live in the URL and are replaced, not pushed (D9, §7).
 */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { useStats } from '../api/hooks.js'
import { Button } from '../components/ui/Button.js'
import { PoolsTable } from '../components/ui/PoolsTable.js'
import { EmptyState, Refetch, SectionError, useDelayedPending } from '../components/ui/States.js'
import { dexLabel } from '../lib/format.js'
import { animate } from '../lib/motion.js'
import { defaultDir, nextSort, updatedCaption } from '../lib/poolsTable.js'
import { useDebounced } from '../lib/useDebounced.js'
import { useIsPhone } from '../lib/useMediaQuery.js'
import { CompareDexes } from './lists/CompareDexes.js'
import { AnswerSkeleton, RowsSkeleton } from './lists/ListSkeleton.js'
import { type ChangeMeta, PoolsControls } from './lists/PoolsControls.js'
import { PAGE_SIZE, type PoolsState, readPoolsState, writePoolsState } from './lists/poolsState.js'
import { poolsAnswer, poolsCount, showUnratedLabel } from './lists/poolsText.js'
import { usePoolRows, useUnratedTotal } from './lists/usePoolRows.js'
import './lists/lists.css'

/** The search box follows the URL, and writes to it once typing pauses for 250 ms. */
function useSearchSync(urlQ: string, write: (q: string) => void) {
  const [search, setSearch] = useState(urlQ)
  const debounced = useDebounced(search, 250)
  // The last value written to (or adopted from) the URL: when the URL changes underneath (the nav
  // link, Back, a `/pools?q=` link), an old debounced value must not be written back over it.
  const applied = useRef(urlQ)
  useEffect(() => {
    if (debounced === applied.current) return
    applied.current = debounced
    if (debounced !== urlQ) write(debounced)
  }, [debounced, urlQ, write])
  useEffect(() => {
    setSearch(urlQ)
  }, [urlQ])
  return [search, setSearch] as const
}

/** The answer cross-fades over 150 ms when a pointer changes the DEX filter (§6.2). */
function useAnswerFade(answer: string | null) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const last = useRef(answer)
  const fade = useRef(false)
  useLayoutEffect(() => {
    if (answer === last.current) return
    const had = last.current !== null
    last.current = answer
    if (had && fade.current) {
      animate(ref.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' })
    }
    fade.current = false
  }, [answer])
  return { ref, arm: (on: boolean) => (fade.current = on) }
}

export function Pools() {
  const [params, setParams] = useSearchParams()
  const state = readPoolsState(params)
  const update = (patch: Partial<PoolsState>) =>
    setParams((prev) => writePoolsState(prev, patch), { replace: true })
  const writeQ = useRef((q: string) => update({ q }))
  writeQ.current = (q: string) => update({ q })
  const [search, setSearch] = useSearchSync(state.q, (q) => writeQ.current(q))

  const phone = useIsPhone()
  const now = useDataNow()
  const stats = useStats()
  const pools = usePoolRows(state)
  const unratedOpen = !state.ratedOnly && state.unrated > 0
  const unrated = usePoolRows(state, { rated: false, pages: state.unrated, enabled: unratedOpen })
  const unratedCount = useUnratedTotal(state, !state.ratedOnly)
  const unratedTotal = unrated.total ?? unratedCount ?? 0
  const waiting = !useDelayedPending(stats.isPending || pools.isPending)
  const answer = stats.data ? poolsAnswer(stats.data, state.dex) : null
  const fade = useAnswerFade(answer)
  const filtered = state.q.trim() !== '' || state.dex !== ''

  const onDex = (dex: PoolsState['dex'], meta: ChangeMeta) => {
    fade.arm(!meta.keyboard)
    update({ dex })
  }

  let body: ReactNode
  if (pools.rows) {
    const rows = pools.rows
    // The unrated pools follow the rated ones in the same table, under a quiet heading.
    const shown = unratedOpen && unrated.rows?.length ? [...rows, ...unrated.rows] : rows
    const divider =
      shown.length > rows.length ? { at: rows.length, label: 'Unrated pools' } : undefined
    // The unrated pools are offered once every rated one is on screen.
    const offerUnrated = !state.ratedOnly && pools.remaining === 0 && unratedTotal > 0
    body = (
      <>
        <div className="tbl-caption">
          <span aria-live="polite">
            {poolsCount(pools.total ?? rows.length, stats.data?.totals.rated, filtered, {
              shown: shown.length - rows.length,
              total: unratedTotal,
            })}
          </span>
          <span>{updatedCaption(shown, now)}</span>
        </div>
        {shown.length ? (
          <Refetch busy={pools.busy}>
            <PoolsTable
              rows={shown}
              state={state}
              now={now}
              phone={phone}
              onSort={(key) => update(nextSort(state, key))}
              label="Pools"
              describedBy="pools-answer"
              divider={divider}
            />
          </Refetch>
        ) : (
          <PoolsEmpty
            state={state}
            scored={stats.data?.totals.scored}
            rated={stats.data?.totals.rated}
            hasUnrated={!state.ratedOnly && unratedTotal > 0}
            onClear={() => {
              setSearch('')
              update({ q: '' })
            }}
            onAllDexes={() => update({ dex: '' })}
          />
        )}
        {pools.truncated ? (
          <p className="tbl-note">
            Sorted within the 200 healthiest of {pools.total} pools; the API sorts the rest by
            health.
          </p>
        ) : null}
        {pools.remaining > 0 ? (
          <Button
            className="lists-more"
            loading={pools.loadingMore}
            onClick={() => update({ page: state.page + 1 })}
          >
            Show {Math.min(PAGE_SIZE, pools.remaining)} more pools
          </Button>
        ) : null}
        {offerUnrated ? (
          <div className="lists-unrated">
            {/* One toggle that stays mounted, so keyboard focus stays on it when it is pressed;
                the caption's live region says how many unrated pools are now on screen. */}
            <Button
              variant={unratedOpen ? 'quiet' : 'secondary'}
              aria-expanded={unratedOpen}
              onClick={() => update({ unrated: unratedOpen ? 0 : 1 })}
            >
              {unratedOpen ? 'Hide unrated pools' : showUnratedLabel(unratedTotal)}
            </Button>
            {unratedOpen && unrated.remaining > 0 ? (
              <Button
                loading={unrated.loadingMore}
                onClick={() => update({ unrated: state.unrated + 1 })}
              >
                Show {Math.min(PAGE_SIZE, unrated.remaining)} more unrated pools
              </Button>
            ) : null}
          </div>
        ) : null}
      </>
    )
  } else if (pools.isError) {
    body = (
      <div className="lists-error">
        <SectionError what="pools" onRetry={pools.refetch} />
      </div>
    )
  } else {
    body = (
      <>
        <div className="tbl-caption" aria-hidden="true">
          <span>&nbsp;</span>
        </div>
        <RowsSkeleton waiting={waiting} />
      </>
    )
  }

  return (
    <div className="wrap page lists-pools">
      <title>Pools – Depthwatch</title>
      <div className="title-block">
        <h1 className="h1">Pools</h1>
      </div>
      {answer !== null ? (
        <p ref={fade.ref} id="pools-answer" className="answer answer-block">
          {answer}
        </p>
      ) : stats.isError ? null : (
        <AnswerSkeleton waiting={waiting} />
      )}
      <PoolsControls
        phone={phone}
        search={search}
        onSearch={setSearch}
        dex={state.dex}
        onDex={onDex}
        sort={state.sort}
        dir={state.dir}
        onSortKey={(sort) => update({ sort, dir: defaultDir(sort) })}
        onDir={(dir) => update({ dir })}
        cols={state.cols}
        onCols={(cols) => update({ cols })}
        ratedOnly={state.ratedOnly}
        onRatedOnly={(ratedOnly, meta) => {
          fade.arm(!meta.keyboard)
          update({ ratedOnly })
        }}
      />
      {body}
      {stats.data ? <CompareDexes stats={stats.data} /> : null}
    </div>
  )
}

/** Empty (ST2): what is empty, and the one next step. Never shown before data has loaded. */
function PoolsEmpty({
  state,
  scored,
  rated,
  hasUnrated,
  onClear,
  onAllDexes,
}: {
  state: PoolsState
  scored: number | undefined
  rated: number | undefined
  /** Unrated pools match the filters, so "no pools" would be wrong: no rated pools. */
  hasUnrated: boolean
  onClear: () => void
  onAllDexes: () => void
}) {
  const q = state.q.trim()
  const noun = hasUnrated || state.ratedOnly ? 'rated pools' : 'pools'
  if (q) {
    return (
      <EmptyState action={<Button onClick={onClear}>Clear search</Button>}>
        No {noun} match “{q}”{state.dex ? ` on ${dexLabel(state.dex)}` : ''}.
      </EmptyState>
    )
  }
  if (state.dex && scored !== 0) {
    return (
      <EmptyState action={<Button onClick={onAllDexes}>Show all DEXes</Button>}>
        {hasUnrated || state.ratedOnly
          ? `No pools on ${dexLabel(state.dex)} are rated yet.`
          : `No pools on ${dexLabel(state.dex)} are scored yet.`}
      </EmptyState>
    )
  }
  if (scored !== undefined && scored > 0 && rated === 0) {
    return <EmptyState>No pool is deep enough to rate yet.</EmptyState>
  }
  return <EmptyState>No pools are scored yet. Scores appear after the first snapshots.</EmptyState>
}
