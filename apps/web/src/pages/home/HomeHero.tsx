/**
 * The Home hero (ia-v3 §4.1, docs/design/visual-v3.md §6.1): the display answer with its number,
 * a one-sentence lead with the two actions, and the focal depth butterfly of Base's pools closed
 * by the "All of Base" total row, with its "Show data" table (CH9). From 1200 px the answer and the
 * lead split 7 / 5 above the figure; on phones the figure follows the answer directly (PH6).
 */
import type { UseQueryResult } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { PoolSummary, StatsResponse } from '../../api/types.js'
import { pickButterflyRows } from '../../components/charts/butterflyModel.js'
import { type ButterflyGap, ButterflyTable, DepthButterfly } from '../../components/charts/index.js'
import { ButtonLink } from '../../components/ui/Button.js'
import { SectionError } from '../../components/ui/States.js'
import { count } from '../../lib/format.js'
import { EMPTY_ANSWER, emptyLead, homeAnswer, homeLead } from './copy.js'
import { ButterflySkeleton, LeadSkeleton, LineSkeleton } from './HomeSkeleton.js'

export interface HeroFigure {
  /** Every scored pool once loaded (the total row sums them all). */
  pools: PoolSummary[] | undefined
  /** The biggest meaningful gap, which gets the "Gap" marker; null when there is none. */
  gap: ButterflyGap | null
  /** The figure can draw: the pools and the gap feed (or its failure) are in. */
  ready: boolean
  isError: boolean
  retry: () => void
  /** First view of the session: the bars grow from the spine (M6). */
  intro: boolean
}

function Actions() {
  return (
    <div className="actions">
      <ButtonLink variant="primary" to="/pools">
        Browse pools
      </ButtonLink>
      <Link className="plink" to="/methodology">
        How it’s measured
      </Link>
    </div>
  )
}

/** The answer and the lead, or their skeleton, or the error that replaces them (ST3). */
function HeroText({ stats, waiting }: { stats: UseQueryResult<StatsResponse>; waiting: boolean }) {
  if (stats.data) {
    const t = stats.data.totals
    const empty = t.scored === 0
    return (
      <>
        <h1 className="display" id="home-title">
          {empty ? EMPTY_ANSWER : homeAnswer(t.depth2Usd)}
        </h1>
        <div className="hero-sub">
          <p className="lead">{empty ? emptyLead(t.pools) : homeLead(t.scored, t.rated)}</p>
          <Actions />
        </div>
      </>
    )
  }
  if (stats.isError)
    return (
      <>
        <h1 className="display" id="home-title">
          Liquidity on Base
        </h1>
        <div className="hero-sub">
          <SectionError what="the totals" onRetry={() => void stats.refetch()} />
        </div>
      </>
    )
  return (
    <>
      <h1 className="display" id="home-title" aria-busy="true">
        <span className="sr-only">Loading the totals</span>
        <LineSkeleton lines={2} waiting={waiting} />
      </h1>
      <div className="hero-sub">
        <LeadSkeleton waiting={waiting} />
        <Actions />
      </div>
    </>
  )
}

function Figure({ figure, waiting }: { figure: HeroFigure; waiting: boolean }) {
  if (figure.isError) return <SectionError what="the pools" onRetry={figure.retry} />
  const pools = figure.pools
  if (!figure.ready || !pools) return <ButterflySkeleton waiting={waiting} />
  const rows = pickButterflyRows(pools, figure.gap?.poolId)
  const more =
    pools.length > rows.length ? (
      <Link className="plink" to="/pools?sort=depth">
        Show all {count(pools.length)} pools
      </Link>
    ) : undefined
  return (
    <DepthButterfly
      pools={pools}
      rows={rows}
      gap={figure.gap}
      scope="Base"
      intro={figure.intro}
      more={more}
    >
      {rows.length > 0 ? (
        <ButterflyTable pools={pools} rows={rows} gapPoolId={figure.gap?.poolId} scope="Base" />
      ) : null}
    </DepthButterfly>
  )
}

export function HomeHero({
  stats,
  figure,
  waiting,
}: {
  stats: UseQueryResult<StatsResponse>
  figure: HeroFigure
  /** Loading for under 300 ms: skeletons hold their space but stay invisible (M10). */
  waiting: boolean
}) {
  return (
    <section className="hero" aria-labelledby="home-title">
      <HeroText stats={stats} waiting={waiting} />
      <div className="hero-fig">
        <Figure figure={figure} waiting={waiting} />
      </div>
    </section>
  )
}
