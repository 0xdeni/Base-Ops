/**
 * `/` (ia-v3 §4.1, docs/design/visual-v3.md §6.1): one answer, one figure, three facts. The display
 * sentence states Base's depth within 2 % of the price; the focal depth butterfly shows where that
 * depth sits pool by pool, closed by the "All of Base" total row and its "Show data" table; the
 * facts give the 24 h volume, the median health and the biggest gap; two previews hand the reader
 * to the gaps feed and the market-maker scorecards. Home has no URL state (ia-v3 §2).
 */
import { useGaps, useScorecards, useStats } from '../api/hooks.js'
import type { ButterflyGap } from '../components/charts/index.js'
import { useDelayedPending } from '../components/ui/States.js'
import { isMeaningfulGap } from './home/copy.js'
import { HomeFacts } from './home/HomeFacts.js'
import { type HeroFigure, HomeHero } from './home/HomeHero.js'
import { FactsSkeleton } from './home/HomeSkeleton.js'
import { GapsPreview, MandatesPreview } from './home/Previews.js'
import { useAllPools } from './home/useAllPools.js'
import { useIntro } from './home/useIntro.js'
import './home/home.css'

/** Enough of the gap feed to count every pool trading 3× its depth or more (the API's page). */
const GAP_FEED_LIMIT = 200

export function Home() {
  const stats = useStats()
  const all = useAllPools()
  const gaps = useGaps({ limit: GAP_FEED_LIMIT })
  const scorecards = useScorecards()

  const meaningful = gaps.data?.items.filter(isMeaningfulGap)
  const biggest = meaningful?.[0]
  const gap: ButterflyGap | null =
    biggest && biggest.gap.turnoverRatio !== null
      ? { poolId: biggest.pool.pool.id, turnoverRatio: biggest.gap.turnoverRatio }
      : null
  const ready = all.pools !== undefined && !gaps.isPending
  const intro = useIntro(ready && (all.pools?.length ?? 0) > 0)
  const pending = stats.isPending || all.isPending || gaps.isPending || scorecards.isPending
  const waiting = !useDelayedPending(pending)

  const figure: HeroFigure = {
    // Sides as stored (token0's), the same values the pool's page and scorecards show.
    pools: all.pools,
    gap,
    ready,
    isError: all.isError,
    retry: all.refetch,
    intro,
  }
  const totals = stats.data?.totals
  // The facts wait for the gap feed too, so the third fact never pops in beside the other two.
  const facts =
    totals && !gaps.isPending ? (
      totals.scored > 0 ? (
        <HomeFacts totals={totals} top={gaps.data?.items[0]} />
      ) : null
    ) : stats.isError ? null : (
      <FactsSkeleton waiting={waiting} />
    )
  return (
    <div className="wrap home">
      <HomeHero stats={stats} figure={figure} waiting={waiting} />
      {facts}
      <div className="previews">
        <GapsPreview gaps={gaps} meaningful={meaningful} waiting={waiting} />
        <MandatesPreview scorecards={scorecards} pools={all.pools} waiting={waiting} />
      </div>
    </div>
  )
}
