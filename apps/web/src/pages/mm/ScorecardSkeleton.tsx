/**
 * The Scorecard while it loads (ST1, M10, docs/design/visual-v4.md §5.12): the title section, the
 * band with a static white 14 % block where the KPI chart goes, and the facts row's ink block at
 * its final height, laid out from the first frame so nothing moves when the data arrives; the
 * blocks are only painted after 300 ms. The back link renders at once, and so does the whole
 * title section when the scorecards list and the pool's summary are already loaded
 * (`cachedScorecard`).
 */
import type { ScorecardDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { Band } from '../../components/ui/Band.js'
import { Overlap } from '../../components/ui/Block.js'
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { ScorecardTitle } from './ScorecardTitle.js'

function Answer({ hidden }: { hidden: boolean }) {
  return (
    <SkeletonGroup label="Loading scorecard" hidden={hidden} className="sc-skel-answer">
      <Skeleton height="1.08em" width="90%" />
      <Skeleton height="1.08em" width="70%" />
    </SkeletonGroup>
  )
}

function Rest({ hidden }: { hidden: boolean }) {
  const phone = useIsPhone()
  return (
    <>
      <Band label="Loading scorecard" className="sc-band">
        <SkeletonGroup label="Loading the KPI chart" hidden={hidden}>
          <Skeleton height={phone ? 236 : 284} />
        </SkeletonGroup>
      </Band>
      <Overlap>
        <div
          className="blk ink sc-skel-facts"
          style={hidden ? { visibility: 'hidden' } : undefined}
          aria-hidden="true"
        />
      </Overlap>
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
  if (cached) {
    return (
      <div className="sc">
        <ScorecardTitle detail={cached} answer={<Answer hidden={!visible} />} />
        <Rest hidden={!visible} />
      </div>
    )
  }
  return (
    <div className="sc">
      <section className="wrap ttl sc-ttl" aria-label="Scorecard">
        <BackLink to="/mm" label="Scorecards" />
        <SkeletonGroup label="Loading scorecard" hidden={!visible} className="sc-skel-title">
          <Skeleton height={12} width="min(100%, 36ch)" />
          <Skeleton height="1.92em" width="min(100%, 14ch)" className="sc-skel-h1" />
          <Skeleton height={32} width={120} />
        </SkeletonGroup>
      </section>
      <Rest hidden={!visible} />
    </div>
  )
}
