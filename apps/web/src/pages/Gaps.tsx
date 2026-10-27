/**
 * `/gaps` (ia-v3 §4.4, docs/design/visual-v3.md §6.4): where demand outruns depth, the pools where
 * market makers are missing. The h1, the answer ("1 pool trades 3× its depth or more every day."),
 * one lead sentence, a caption with the volume floor, "How the score works" and the List / Table
 * control, then the ranked gap rows (the focal element) with the rows under 3× behind one quiet
 * disclosure, or the table view with every v2 column. `view`, `sort` and `dir` live in the URL.
 */
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGaps } from '../api/hooks.js'
import { SegmentedControl } from '../components/ui/SegmentedControl.js'
import { EmptyState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { NB, usd } from '../lib/format.js'
import { GapRows } from './lists/GapRows.js'
import { GapsTable } from './lists/GapsTable.js'
import {
  type GapsState,
  type GapsView,
  gapsAnswer,
  isMeaningful,
  readGapsState,
  writeGapsState,
} from './lists/gapsModel.js'
import { AnswerSkeleton, RowsSkeleton } from './lists/ListSkeleton.js'
import './lists/lists.css'

/** The API's page for the feed (ia-v3 §4.4: `useGaps({limit: 100})`). */
const LIMIT = 100

export function Gaps() {
  const [params, setParams] = useSearchParams()
  const state = readGapsState(params)
  const update = (patch: Partial<GapsState>) =>
    setParams((prev) => writeGapsState(prev, patch), { replace: true })
  const gaps = useGaps({ limit: LIMIT })
  const waiting = !useDelayedPending(gaps.isPending)
  const items = gaps.data?.items
  const meaningful = items?.filter(isMeaningful).length

  let body: ReactNode
  if (items && gaps.data) {
    const floor = usd(gaps.data.minVolumeUsd)
    body = (
      <>
        <div className="tbl-caption lists-gaps-caption">
          <span>
            Pools with at least {floor} of 24{NB}h volume
          </span>
          <span className="lists-gaps-ctl">
            <Link className="plink touch-hit" to="/methodology#gaps">
              How the score works
            </Link>
            <SegmentedControl<GapsView>
              label="View"
              options={[
                { value: 'list', label: 'List' },
                { value: 'table', label: 'Table' },
              ]}
              value={state.view}
              onChange={(view) => update({ view })}
            />
          </span>
        </div>
        {items.length === 0 ? (
          <EmptyState>
            No pool has {floor} of 24{NB}h volume yet, so none can be ranked.
          </EmptyState>
        ) : state.view === 'table' ? (
          <GapsTable
            items={items}
            sort={state.sort}
            dir={state.dir}
            onSort={(key) =>
              update(
                key === state.sort
                  ? { dir: state.dir === 'desc' ? 'asc' : 'desc' }
                  : { sort: key, dir: 'desc' },
              )
            }
          />
        ) : (
          <GapRows items={items} />
        )}
      </>
    )
  } else if (gaps.isError) {
    body = (
      <div className="lists-error">
        <SectionError what="gaps" onRetry={() => void gaps.refetch()} />
      </div>
    )
  } else {
    body = (
      <>
        <div className="tbl-caption lists-gaps-caption lists-skel-caption" aria-hidden="true">
          <span>&nbsp;</span>
        </div>
        <RowsSkeleton waiting={waiting} rows={4} label="Loading gaps" header={false} />
      </>
    )
  }

  return (
    <div className="wrap page lists-gaps">
      <title>Liquidity gaps – Depthwatch</title>
      <div className="title-block">
        <h1 className="h1">Liquidity gaps</h1>
      </div>
      {meaningful !== undefined ? (
        <p className="answer answer-block">{gapsAnswer(meaningful)}</p>
      ) : gaps.isError ? null : (
        <AnswerSkeleton waiting={waiting} width="70%" />
      )}
      <p className="lead lists-lead">
        A gap is a pool that trades far more each day than the liquidity near its price.
      </p>
      {body}
    </div>
  )
}
