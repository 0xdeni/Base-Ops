/**
 * The Token page while it loads (ST1, M10, docs/design/visual-v4.md §5.12): static blocks at the
 * final layout's sizes, laid out from the first frame so the page has its loaded height at once;
 * they are only painted after 300 ms. The back link renders at once, and so do the symbol and name
 * when a pool already loaded names the token (`cachedToken`). On the band the butterfly's frame is
 * white at 14 % (its head, the total row and the pool rows from the spine); the facts row is an
 * ink block over the band's lower edge.
 */
import type { TokenDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { Band } from '../../components/ui/Band.js'
import { Overlap } from '../../components/ui/Block.js'
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'
import { TokenTitle } from './TokenTitle.js'

/** Sell and buy widths of the placeholder rows, as fractions of a side. */
const ROWS: ReadonlyArray<readonly [number, number]> = [
  [0.48, 0.62],
  [0.2, 0.26],
  [0.12, 0.1],
  [0.08, 0.07],
  [0.05, 0.06],
  [0.04, 0.03],
  [0.03, 0.03],
  [0.02, 0.02],
]

const unpainted = (visible: boolean) => (visible ? undefined : { visibility: 'hidden' as const })

function Line({ width }: { width: string }) {
  return (
    <span className="token-skel-line">
      <Skeleton height="100%" width={width} />
    </span>
  )
}

function AnswerSkeleton({ visible }: { visible: boolean }) {
  return (
    <p className="answer token-skel-text" aria-hidden="true" style={unpainted(visible)}>
      <Line width="100%" />
      <Line width="90%" />
      <Line width="56%" />
    </p>
  )
}

export function TokenSkeleton({
  visible,
  token,
}: {
  visible: boolean
  token?: TokenDetail['token']
}) {
  return (
    <div className="token">
      {token ? (
        <TokenTitle token={token} answer={<AnswerSkeleton visible={visible} />} />
      ) : (
        <section className="wrap ttl token-ttl" aria-label="Loading token">
          <BackLink to="/pools" label="Pools" />
          <p className="eyebrow token-eb">Token</p>
          <div className="ttl-grid" aria-hidden="true" style={unpainted(visible)}>
            <div className="token-ttl-main">
              <span className="title token-skel-text">
                <Line width="3.4em" />
              </span>
              <span className="token-name token-skel-text">
                <Line width="10ch" />
              </span>
            </div>
            <AnswerSkeleton visible={visible} />
          </div>
        </section>
      )}
      <Band label="Depth by pool" className="token-band">
        <SkeletonGroup label="Loading token" hidden={!visible} className="token-skel-band">
          <Skeleton height={16} width="min(100%, 320px)" />
          <span className="token-skel-head">
            <Skeleton height={40} width="30%" className="is-sell" />
            <Skeleton height={40} width="30%" />
          </span>
          <span className="token-skel-row is-total">
            <Skeleton height="100%" width="78%" className="is-sell" />
            <Skeleton height="100%" width="88%" />
          </span>
          {ROWS.map(([s, b]) => (
            <span key={`${s}-${b}`} className="token-skel-row">
              <Skeleton height={12} width={`${s * 100}%`} className="is-sell" />
              <Skeleton height={12} width={`${b * 100}%`} />
            </span>
          ))}
        </SkeletonGroup>
      </Band>
      <Overlap label="Facts">
        <div className="blk ink token-skel-facts" aria-hidden="true" style={unpainted(visible)}>
          {[0, 1, 2].map((i) => (
            <span key={i}>
              <Skeleton height={44} width="60%" />
              <Skeleton height={13} width="70%" />
            </span>
          ))}
        </div>
      </Overlap>
    </div>
  )
}
