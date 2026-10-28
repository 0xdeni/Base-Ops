/**
 * The Home band (docs/design/visual-v4.md §6.2): full-bleed Base Blue from the app bar down. The
 * eyebrow, then one heading made of the figure ("$49.9M" at `--t-mega`) and its sentence ("sits
 * within 2 % of the price on Base." at `--t-say`) sharing a baseline; under them the lead at left
 * and the actions at right ("Browse pools", the white button on the band, and "How it's measured").
 * Then the focal depth butterfly of Base on the band, with its "Show data" table (CH9). On phones
 * everything stacks in that order and the butterfly's top half stays in the first viewport (PH6).
 *
 * The first view (§4.1) rises the figure and the sentence (`data-rise`), the eyebrow and the lead
 * with the actions (`data-in`); the band's ground and the butterfly's bars are the band's own.
 */
import type { UseQueryResult } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { PoolSummary, StatsResponse } from '../../api/types.js'
import { pickButterflyRows } from '../../components/charts/butterflyModel.js'
import { type ButterflyGap, ButterflyTable, DepthButterfly } from '../../components/charts/index.js'
import { Band } from '../../components/ui/Band.js'
import { ButtonLink } from '../../components/ui/Button.js'
import { SectionError } from '../../components/ui/States.js'
import { NB } from '../../lib/format.js'
import { EMPTY_ANSWER, ERROR_ANSWER, emptyLead, HOME_SAY, homeFigure, homeLead } from './copy.js'
import { ButterflySkeleton, HeroSkeleton } from './HomeSkeleton.js'

export interface HeroFigure {
  /** Every scored pool once loaded (the total row sums them all). */
  pools: PoolSummary[] | undefined
  /** The biggest meaningful gap, which gets the "Gap" marker; null when there is none. */
  gap: ButterflyGap | null
  /** The figure can draw: the pools and the gap feed (or its failure) are in. */
  ready: boolean
  isError: boolean
  retry: () => void
}

function Actions() {
  return (
    <div className="actions home-acts">
      <ButtonLink variant="on-band" to="/pools">
        Browse pools
      </ButtonLink>
      <Link className="ulink" to="/methodology">
        How it’s measured
      </Link>
    </div>
  )
}

/** The heading, the lead and the actions, or their skeleton, or the error that replaces them. */
function HeroText({ stats, waiting }: { stats: UseQueryResult<StatsResponse>; waiting: boolean }) {
  if (stats.data) {
    const t = stats.data.totals
    const empty = t.scored === 0
    return (
      <div className="hero-top">
        <h1 className="hero-h1" id="home-title">
          {empty ? (
            <span className="say" data-rise="">
              {EMPTY_ANSWER}
            </span>
          ) : (
            <>
              <span className="mega num" data-rise="">
                {homeFigure(t.depth2Usd)}
              </span>{' '}
              <span className="say" data-rise="">
                {HOME_SAY}
              </span>
            </>
          )}
        </h1>
        <div className="hero-side" data-in="">
          <p className="lead">{empty ? emptyLead(t.pools) : homeLead(t.scored, t.rated)}</p>
          <Actions />
        </div>
      </div>
    )
  }
  if (stats.isError)
    return (
      <div className="hero-top">
        <h1 className="hero-h1" id="home-title">
          <span className="say" data-rise="">
            {ERROR_ANSWER}
          </span>
        </h1>
        <div className="hero-side" data-in="">
          <SectionError what="the totals" onRetry={() => void stats.refetch()} />
          <Actions />
        </div>
      </div>
    )
  return (
    <div className="hero-top">
      <h1 className="hero-h1" id="home-title" aria-busy="true">
        <span className="sr-only">Loading the totals</span>
        <HeroSkeleton waiting={waiting} />
      </h1>
      <div className="hero-side">
        <HeroSkeleton lead waiting={waiting} />
        <Actions />
      </div>
    </div>
  )
}

function Figure({ figure, waiting }: { figure: HeroFigure; waiting: boolean }) {
  if (figure.isError)
    return (
      <div className="home-fig-error">
        <SectionError what="the pools" onRetry={figure.retry} />
      </div>
    )
  const pools = figure.pools
  if (!figure.ready || !pools) return <ButterflySkeleton waiting={waiting} />
  const rows = pickButterflyRows(pools, figure.gap?.poolId)
  return (
    <DepthButterfly pools={pools} rows={rows} gap={figure.gap} scope="Base">
      {rows.length > 0 ? (
        <ButterflyTable pools={pools} rows={rows} gapPoolId={figure.gap?.poolId} scope="Base" />
      ) : null}
    </DepthButterfly>
  )
}

export function HomeHero({
  stats,
  figure,
  closed,
  waiting,
}: {
  stats: UseQueryResult<StatsResponse>
  figure: HeroFigure
  /** No facts stack over the band's lower edge (nothing scored, or the totals failed). */
  closed: boolean
  /** Loading for under 300 ms: skeletons hold their space but stay invisible (M10). */
  waiting: boolean
}) {
  return (
    <Band
      hero
      closed={closed}
      labelledBy="home-title"
      className="home-band"
      eyebrow={
        <>
          <span className="ph-hide">Base mainnet</span>
          <span>Depth within ±2{NB}% of the price</span>
        </>
      }
    >
      <HeroText stats={stats} waiting={waiting} />
      <Figure figure={figure} waiting={waiting} />
    </Band>
  )
}
