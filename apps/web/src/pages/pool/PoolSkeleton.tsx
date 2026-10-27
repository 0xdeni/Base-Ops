/**
 * The Pool page while it loads (ST1, M10): static `well` blocks at the final layout's heights
 * (title, answer, the 340 / 240 px curve, four facts), laid out from the first frame so the page
 * has its loaded height at once and nothing below it moves; they are only painted after 300 ms.
 * The back link renders at once, and so does the whole title block when a list already loaded
 * this pool's summary (`cachedPoolSummary`): the pair, DEX, fee and price never wait.
 */
import type { PoolSummary } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { PoolTitle } from './PoolTitle.js'

function Rest({ phone, titled }: { phone: boolean; titled: boolean }) {
  return (
    <>
      <Skeleton
        height={phone ? 78 : 60}
        width="min(100%, 44ch)"
        className={titled ? undefined : 'pool-skel-answer'}
      />
      <Skeleton height={phone ? 264 : 366} className="pool-skel-curve" />
      <span className="pool-skel-facts">
        {[0, 1, 2, 3].map((i) => (
          <span key={i}>
            <Skeleton height={40} width="70%" />
            <Skeleton height={13} width="40%" />
          </span>
        ))}
      </span>
    </>
  )
}

export function PoolSkeleton({ visible, summary }: { visible: boolean; summary?: PoolSummary }) {
  const phone = useIsPhone()
  if (summary) {
    return (
      <div className="wrap page">
        <PoolTitle pool={summary.pool} spot={summary.price} />
        <SkeletonGroup label="Loading pool" hidden={!visible} className="answer-block">
          <Rest phone={phone} titled />
        </SkeletonGroup>
      </div>
    )
  }
  return (
    <div className="wrap page">
      <div className="title-block">
        <BackLink to="/pools" label="Pools" />
        <SkeletonGroup label="Loading pool" hidden={!visible}>
          <Skeleton height={39} width="12ch" />
          <Skeleton height={20} width="min(100%, 420px)" />
          <Rest phone={phone} titled={false} />
        </SkeletonGroup>
      </div>
    </div>
  )
}
