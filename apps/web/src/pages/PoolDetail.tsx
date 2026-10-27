/**
 * Pool (`/pools/:id`, ia-v3 §4.3, docs/design/visual-v3.md §6.3): "Is this pool deep and healthy
 * enough, and on which side is it thin?" The title block and the answer sentence, the mirrored
 * depth curve with its Show data, four facts and the gap callout, then the sections in a fixed
 * order: Health, Cost to trade, Who provides it, Over time (`?window=7d`), Mandates on this pool,
 * About this pool. Every number is read as the API stored it and only formatted here.
 */
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { isNotFound } from '../api/errors.js'
import { usePool } from '../api/hooks.js'
import type { HistoryWindow, PoolDetail as PoolDetailDto } from '../api/types.js'
import { DepthCurveTable } from '../components/charts/ChartTables.js'
import { DepthCurve } from '../components/charts/DepthCurve.js'
import { BackLink } from '../components/ui/BackLink.js'
import { NotFoundState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { pairLabel } from '../lib/format.js'
import { cachedPoolSummary } from '../routeData.js'
import { OverTime } from './pool/OverTime.js'
import { PoolAbout } from './pool/PoolAbout.js'
import { PoolFacts } from './pool/PoolFacts.js'
import { PoolMandates } from './pool/PoolMandates.js'
import { CostSection, HealthSection, WhoSection } from './pool/PoolSections.js'
import { PoolSkeleton } from './pool/PoolSkeleton.js'
import { PoolTitle } from './pool/PoolTitle.js'
import { poolAnswer } from './pool/poolText.js'
import './pool/pool.css'

function decodePoolId(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function PoolView({
  detail,
  win,
  onWindow,
}: {
  detail: PoolDetailDto
  win: HistoryWindow
  onWindow: (w: HistoryWindow) => void
}) {
  const { pool, latest } = detail
  const pair = pairLabel(pool.token0, pool.token1)
  return (
    <div className="wrap page">
      <title>{`${pair} – Depthwatch`}</title>
      <PoolTitle pool={pool} spot={latest?.price ?? null} />
      <p className="answer answer-block">{poolAnswer(detail)}</p>
      {latest ? (
        <div className="pool-fig">
          <DepthCurve snapshot={latest} token0={pool.token0} token1={pool.token1}>
            <DepthCurveTable snapshot={latest} token0={pool.token0} token1={pool.token1} />
          </DepthCurve>
        </div>
      ) : null}
      <PoolFacts detail={detail} />
      <div className="secs">
        <HealthSection detail={detail} />
        <CostSection detail={detail} />
        <WhoSection detail={detail} />
        <OverTime detail={detail} window={win} onWindow={onWindow} />
        <PoolMandates pool={pool} />
        <PoolAbout detail={detail} />
      </div>
    </div>
  )
}

export function PoolDetail() {
  const { id: rawId = '' } = useParams()
  const id = decodePoolId(rawId)
  const pool = usePool(id)
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const win: HistoryWindow = params.get('window') === '7d' ? '7d' : '24h'
  const showSkeleton = useDelayedPending(pool.isPending)

  const onWindow = (w: HistoryWindow) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (w === '24h') next.delete('window')
        else next.set('window', w)
        return next
      },
      { replace: true },
    )

  let content: ReactNode
  if (pool.data) {
    content = <PoolView detail={pool.data} win={win} onWindow={onWindow} />
  } else if (pool.isError && isNotFound(pool.error)) {
    content = (
      <NotFoundState
        title="Pool not found"
        message="Depthwatch does not track this pool, or the link is wrong."
        id={id}
      />
    )
  } else if (pool.isError) {
    content = (
      <div className="wrap page">
        <div className="title-block">
          <BackLink to="/pools" label="Pools" />
        </div>
        <div className="answer-block">
          <SectionError what="this pool" onRetry={() => void pool.refetch()} />
        </div>
      </div>
    )
  } else {
    // The title block from a list that already holds this pool, so it never waits (ST1).
    content = <PoolSkeleton visible={showSkeleton} summary={cachedPoolSummary(qc, id)} />
  }
  return content
}
