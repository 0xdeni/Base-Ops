/**
 * The Scorecard page while it loads (ST1, M10): static `well` blocks at the final layout's heights
 * (title, meta line, answer, the chart's head row and its 340 / 240 px plot, three facts), laid out
 * from the first frame so the page has its loaded height at once; they are only painted after
 * 300 ms. The back link renders at once, and so does the whole title block when the scorecards
 * list and the pool's summary are already loaded (`cachedScorecard`).
 */
import type { ScorecardDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { ScorecardTitle } from './ScorecardTitle.js'

function Rest({ phone, titled }: { phone: boolean; titled: boolean }) {
  return (
    <>
      <Skeleton
        height={phone ? 64 : 31}
        width="min(100%, 44ch)"
        className={titled ? undefined : 'sc-skel-answer'}
      />
      <Skeleton height={32} className="sc-skel-head" />
      <Skeleton height={phone ? 240 : 340} className="sc-skel-plot" />
      <span className="sc-skel-facts">
        {[0, 1, 2].map((i) => (
          <span key={i}>
            <Skeleton height={40} width="60%" />
            <Skeleton height={6} width="min(100%, 220px)" />
            <Skeleton height={13} width="70%" />
          </span>
        ))}
      </span>
    </>
  )
}

export function ScorecardSkeleton({
  visible,
  cached,
}: {
  visible: boolean
  cached?: ScorecardDetail
}) {
  const phone = useIsPhone()
  if (cached) {
    return (
      <div className="wrap page sc-page">
        <ScorecardTitle detail={cached} />
        <SkeletonGroup label="Loading scorecard" hidden={!visible} className="answer-block">
          <Rest phone={phone} titled />
        </SkeletonGroup>
      </div>
    )
  }
  return (
    <div className="wrap page sc-page">
      <div className="title-block">
        <BackLink to="/mm" label="Scorecards" />
        <SkeletonGroup label="Loading scorecard" hidden={!visible}>
          <Skeleton height={39} width="min(100%, 28ch)" />
          <Skeleton height={20} width="min(100%, 420px)" />
          <Rest phone={phone} titled={false} />
        </SkeletonGroup>
      </div>
    </div>
  )
}
