/**
 * The Pool page while it loads (ST1, M10, docs/design/visual-v4.md §5.12): static blocks at the
 * final layout's sizes, laid out from the first frame so the page has its loaded height at once
 * and nothing below moves; they are only painted after 300 ms. The title section renders at once
 * when a list already loaded this pool's summary (`cachedPoolSummary`): the pair, DEX, fee and
 * price never wait. On the band the blocks are white at 14 % (the legend row, the 340 / 240 px
 * curve and its foot row); the facts row is an ink block over the band's lower edge.
 */
import type { PoolSummary } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { Band } from '../../components/ui/Band.js'
import { Overlap } from '../../components/ui/Block.js'
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { PoolTitle } from './PoolTitle.js'

/** One line of text at its parent's size and leading, as a block a little shorter than the line. */
function Line({ width }: { width: string }) {
  return (
    <span className="pool-skel-line">
      <Skeleton height="100%" width={width} />
    </span>
  )
}

const unpainted = (visible: boolean) => (visible ? undefined : { visibility: 'hidden' as const })

function AnswerSkeleton({ visible }: { visible: boolean }) {
  return (
    <p className="answer pool-skel-text" aria-hidden="true" style={unpainted(visible)}>
      <Line width="100%" />
      <Line width="92%" />
      <Line width="64%" />
    </p>
  )
}

function TitleSkeleton({ visible }: { visible: boolean }) {
  return (
    <section className="wrap ttl pool-ttl" aria-label="Loading pool">
      <BackLink to="/pools" label="Pools" />
      <p className="eyebrow pool-eb pool-skel-text" aria-hidden="true" style={unpainted(visible)}>
        <Line width="18ch" />
      </p>
      <div className="ttl-grid">
        <div className="pool-ttl-main" aria-hidden="true" style={unpainted(visible)}>
          <span className="title pool-skel-text">
            <Line width="5.2em" />
          </span>
          <span className="pool-line pool-skel-text">
            <Skeleton height={20} width="min(100%, 220px)" />
          </span>
        </div>
        <AnswerSkeleton visible={visible} />
      </div>
    </section>
  )
}

export function PoolSkeleton({ visible, summary }: { visible: boolean; summary?: PoolSummary }) {
  const phone = useIsPhone()
  return (
    <div className="pool">
      {summary ? (
        <PoolTitle
          pool={summary.pool}
          spot={summary.price}
          answer={<AnswerSkeleton visible={visible} />}
        />
      ) : (
        <TitleSkeleton visible={visible} />
      )}
      <Band label="Depth to move the price" className="pool-band">
        <SkeletonGroup label="Loading pool" hidden={!visible} className="pool-skel-band">
          <span className="pool-skel-legend">
            <Skeleton height={14} width={phone ? '38%' : '15%'} />
            <Skeleton height={14} width={phone ? '38%' : '15%'} />
          </span>
          {phone ? <Skeleton height={56} width="100%" className="pool-skel-read" /> : null}
          <Skeleton height={phone ? 240 : 340} className="pool-skel-curve" />
          <Skeleton height={16} width={phone ? '40%' : '18%'} className="pool-skel-foot" />
        </SkeletonGroup>
      </Band>
      <Overlap label="Facts">
        <div className="blk ink pool-skel-facts" aria-hidden="true" style={unpainted(visible)}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i}>
              <Skeleton height={phone ? 28 : 52} width="70%" />
              <Skeleton height={13} width="80%" />
              <Skeleton height={13} width="50%" />
            </span>
          ))}
        </div>
      </Overlap>
    </div>
  )
}
