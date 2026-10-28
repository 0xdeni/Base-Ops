/**
 * `/pools` (ia-v3 §4.2, docs/design/visual-v4.md §6.3): find any pool and compare it with its
 * peers. The page opens on the band: the eyebrow, the lowercase title "pools", the filter-aware
 * answer ("492 pools on 4 DEXes hold $49.9M within 2 % of the price.") and the DEX filter with each
 * DEX's share of the depth on the left; the focal square field on the right; the search, Rating
 * and Columns controls under both (on phones the search, then Filter and Sort sheets). The table
 * sheet stacks over the band's lower edge with the ranked rated pools, their pages and the unrated
 * pools behind one toggle, then "Compare DEXes" sits in a panel. Search, sort, direction, DEX,
 * rating, columns, pages and phone rows live in the URL and are replaced, not pushed (§7).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { useStats } from '../api/hooks.js'
import { Band } from '../components/ui/Band.js'
import { Overlap } from '../components/ui/Block.js'
import { SectionError, useDelayedPending } from '../components/ui/States.js'
import { animate, DUR, EASE, prefersReducedMotion } from '../lib/motion.js'
import { defaultDir, nextSort } from '../lib/poolsTable.js'
import { useAllPools } from '../lib/useAllPools.js'
import { useDebounced } from '../lib/useDebounced.js'
import { useIsPhone } from '../lib/useMediaQuery.js'
import { CompareDexes } from './lists/CompareDexes.js'
import { AnswerSkeleton, DexSkeleton, RowsSkeleton } from './lists/ListSkeleton.js'
import { PoolsControls, PoolsDexFilter, useDexRows } from './lists/PoolsControls.js'
import { PoolsField } from './lists/PoolsField.js'
import { PoolsSheet } from './lists/PoolsSheet.js'
import { type PoolsState, readPoolsState, writePoolsState } from './lists/poolsState.js'
import { poolsAnswer } from './lists/poolsText.js'
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

/**
 * A pointer change of the filter settles the new answer in (§4.3, number change): it fades in and
 * rises from 0.32em over 200 ms `--ease-out`; reduced motion keeps the fade; a keyboard change
 * swaps it at once.
 */
function useAnswerSettle(answer: string | null) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const last = useRef(answer)
  const armed = useRef(false)
  useLayoutEffect(() => {
    if (answer === last.current) return
    const had = last.current !== null
    last.current = answer
    if (had && armed.current) {
      animate(
        ref.current,
        prefersReducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translateY(0.32em)' },
              { opacity: 1, transform: 'none' },
            ],
        { duration: DUR.fade, easing: EASE.out },
      )
    }
    armed.current = false
  }, [answer])
  return { ref, arm: (on: boolean) => (armed.current = on) }
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
  const field = useAllPools()
  const pools = usePoolRows(state)
  const unratedOpen = !state.ratedOnly && state.unrated > 0
  const unrated = usePoolRows(state, { rated: false, pages: state.unrated, enabled: unratedOpen })
  const unratedCount = useUnratedTotal(state, !state.ratedOnly)
  const unratedTotal = unrated.total ?? unratedCount ?? 0
  const waiting = !useDelayedPending(stats.isPending || pools.isPending || field.isPending)
  const answer = stats.data ? poolsAnswer(stats.data, state.dex) : null
  const settle = useAnswerSettle(answer)
  const dexRows = useDexRows(stats.data)

  const onDex = (dex: PoolsState['dex'], meta: { keyboard: boolean }) => {
    settle.arm(!meta.keyboard)
    update({ dex })
  }

  let sheet = (
    <>
      <div className="tbl-caption" aria-hidden="true">
        <span>&nbsp;</span>
      </div>
      <RowsSkeleton waiting={waiting} />
    </>
  )
  if (pools.rows) {
    sheet = (
      <PoolsSheet
        state={state}
        phone={phone}
        now={now}
        pools={pools}
        unrated={unrated}
        unratedTotal={unratedTotal}
        scored={stats.data?.totals.scored}
        rated={stats.data?.totals.rated}
        update={update}
        onSort={(key) => update(nextSort(state, key))}
        onClearSearch={() => {
          setSearch('')
          update({ q: '' })
        }}
      />
    )
  } else if (pools.isError) {
    sheet = (
      <div className="lists-error">
        <SectionError what="pools" onRetry={pools.refetch} />
      </div>
    )
  }

  return (
    <div className="lists-pools">
      <title>Pools – Depthwatch</title>
      <Band
        labelledBy="pools-title"
        className="lists-band"
        eyebrow={
          <>
            <span>Pools</span>
            <span>Uniswap and Aerodrome</span>
          </>
        }
      >
        <div className="lists-grid">
          <div className="lists-left">
            <h1 className="title" id="pools-title" data-rise>
              pools
            </h1>
            {answer !== null ? (
              <p ref={settle.ref} id="pools-answer" className="answer" data-rise>
                {answer}
              </p>
            ) : stats.isError ? null : (
              <AnswerSkeleton waiting={waiting} lines={3} />
            )}
            {phone ? null : dexRows ? (
              <PoolsDexFilter rows={dexRows} dex={state.dex} onDex={onDex} />
            ) : stats.isError ? null : (
              <DexSkeleton waiting={waiting} />
            )}
          </div>
          <PoolsField field={field} state={state} waiting={waiting} />
        </div>
        <PoolsControls
          phone={phone}
          search={search}
          onSearch={setSearch}
          dexRows={dexRows}
          dex={state.dex}
          onDex={onDex}
          sort={state.sort}
          dir={state.dir}
          onSortKey={(sort) => update({ sort, dir: defaultDir(sort) })}
          onDir={(dir) => update({ dir })}
          cols={state.cols}
          onCols={(cols) => update({ cols })}
          ratedOnly={state.ratedOnly}
          onRatedOnly={(ratedOnly) => update({ ratedOnly })}
        />
      </Band>
      <Overlap label="Pools table">
        <div className="blk blk--over blk--flush lists-sheet" data-over="">
          {sheet}
        </div>
      </Overlap>
      {stats.data ? (
        <div className="wrap lists-compare">
          <div className="blk blk--panel">
            <CompareDexes stats={stats.data} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
