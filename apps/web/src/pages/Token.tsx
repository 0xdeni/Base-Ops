/**
 * Token (`/tokens/:address`, ia-v3 §4.7, docs/design/visual-v3.md §6.7): how liquid the token is on
 * Base, where its liquidity sits and where its price comes from. The Pool title block, the answer,
 * the depth butterfly of the token's pools on its own scale (closed by "All of WETH"), three facts,
 * then the pools table (`sort`, `dir`, `cols` in the URL) and About this token.
 */
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { ApiError } from '../api/errors.js'
import { useGaps, usePoolMetas, useToken } from '../api/hooks.js'
import type { PoolMetaDto, TokenDetail } from '../api/types.js'
import { ButterflyTable } from '../components/charts/ChartTables.js'
import { DepthButterfly } from '../components/charts/DepthButterfly.js'
import { MEANINGFUL_GAP_TURNOVER } from '../components/charts/TurnoverGlyph.js'
import { BackLink } from '../components/ui/BackLink.js'
import { NotFoundState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { isPoolId } from '../lib/format.js'
import type { TableState } from '../lib/poolsTable.js'
import { cachedToken } from '../routeData.js'
import { TokenAbout } from './token/TokenAbout.js'
import { TokenFacts } from './token/TokenFacts.js'
import { TokenPools } from './token/TokenPools.js'
import { TokenSkeleton } from './token/TokenSkeleton.js'
import { readTableState, tokenQuery, writeTableState } from './token/tokenSort.js'
import { orientPools, tokenAnswer } from './token/tokenText.js'
import './token/token.css'

/** The biggest meaningful gap (turnover ≥ 3×) among the token's pools, for the "Gap" marker. */
function useTokenGap(detail: TokenDetail | undefined) {
  const gaps = useGaps({ limit: 200 })
  if (!detail) return null
  const mine = new Set(detail.pools.map((p) => p.pool.id))
  const best = (gaps.data?.items ?? [])
    .filter(
      (g) => mine.has(g.pool.pool.id) && (g.gap.turnoverRatio ?? 0) >= MEANINGFUL_GAP_TURNOVER,
    )
    .sort((a, b) => (b.gap.turnoverRatio ?? 0) - (a.gap.turnoverRatio ?? 0))[0]
  return best?.gap.turnoverRatio != null
    ? { poolId: best.pool.pool.id, turnoverRatio: best.gap.turnoverRatio }
    : null
}

function TokenView({
  detail,
  state,
  busy,
  onState,
}: {
  detail: TokenDetail
  state: TableState
  busy: boolean
  onState: (next: TableState) => void
}) {
  const now = useDataNow()
  const { token } = detail
  const pools = orientPools(detail.pools, token.address)
  const gap = useTokenGap(detail)
  const known = new Map<string, PoolMetaDto>(detail.pools.map((p) => [p.pool.id, p.pool]))
  const fetched = usePoolMetas(detail.via.filter((s) => isPoolId(s) && !known.has(s)))
  const metas = new Map([...known, ...fetched])
  const more =
    pools.length > 8 ? (
      <button
        type="button"
        className="plink token-more"
        onClick={() => document.getElementById('s-pools')?.scrollIntoView({ block: 'start' })}
      >
        Show all {pools.length} pools
      </button>
    ) : null
  return (
    <div className="wrap page">
      <title>{`${token.symbol} – Depthwatch`}</title>
      <div className="title-block">
        <BackLink to="/pools" label="Pools" />
        <h1 className="h1">{token.symbol}</h1>
        <div className="subline">
          <span>{token.name}</span>
        </div>
      </div>
      <p className="answer answer-block">{tokenAnswer(detail)}</p>
      {pools.length ? (
        <div className="token-fig">
          <DepthButterfly pools={pools} gap={gap} scope={token.symbol} more={more}>
            <ButterflyTable pools={pools} gapPoolId={gap?.poolId} scope={token.symbol} />
            <p className="tbl-note">
              Sides are {token.symbol}’s: selling {token.symbol} pushes its price down. A pool
              counts in full on the page of each of its two tokens.
            </p>
          </DepthButterfly>
        </div>
      ) : null}
      <TokenFacts detail={detail} metas={metas} />
      <div className="secs">
        <TokenPools
          pools={pools}
          symbol={token.symbol}
          state={state}
          busy={busy}
          now={now}
          onChange={onState}
        />
        <TokenAbout detail={detail} metas={metas} now={now} />
      </div>
    </div>
  )
}

export function Token() {
  const { address = '' } = useParams()
  const normalized = address.toLowerCase()
  const [params, setParams] = useSearchParams()
  const state = readTableState(params)
  const token = useToken(normalized, tokenQuery(state))
  const qc = useQueryClient()
  const showSkeleton = useDelayedPending(token.isPending)
  const onState = (next: TableState) =>
    setParams((prev) => writeTableState(prev, next), { replace: true })

  let content: ReactNode
  if (token.data) {
    content = (
      <TokenView
        detail={token.data}
        state={state}
        busy={token.isFetching && token.isPlaceholderData}
        onState={onState}
      />
    )
  } else if (
    token.isError &&
    token.error instanceof ApiError &&
    (token.error.status === 404 || token.error.status === 400)
  ) {
    content = (
      <NotFoundState
        title="Token not found"
        message="Depthwatch has not seen this token in any pool it tracks, or the link is wrong."
        id={normalized}
      />
    )
  } else if (token.isError) {
    content = (
      <div className="wrap page">
        <div className="title-block">
          <BackLink to="/pools" label="Pools" />
        </div>
        <div className="answer-block">
          <SectionError what="this token" onRetry={() => void token.refetch()} />
        </div>
      </div>
    )
  } else {
    // The symbol and name from a pool already loaded, so the title never waits (ST1).
    content = <TokenSkeleton visible={showSkeleton} token={cachedToken(qc, normalized)} />
  }
  return content
}
