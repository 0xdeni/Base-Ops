/**
 * The Token page while it loads (ST1, M10): static `well` blocks where the title, the answer and
 * the butterfly's 14 px bars will be, laid out from the first frame so the page has its loaded
 * height at once; they are only painted after 300 ms. The back link renders at once, and so do
 * the symbol and name when a pool already loaded names the token (`cachedToken`).
 */
import type { TokenDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'

function Rest({ titled }: { titled: boolean }) {
  return (
    <>
      <Skeleton
        height={60}
        width="min(100%, 44ch)"
        className={titled ? undefined : 'token-skel-answer'}
      />
      <span className="token-skel-bars">
        {[0.7, 0.45].map((w) => (
          <span key={w}>
            <Skeleton height={14} width={`${w * 100}%`} className="is-sell" />
            <Skeleton height={14} width={`${w * 90}%`} />
          </span>
        ))}
      </span>
    </>
  )
}

export function TokenSkeleton({
  visible,
  token,
}: {
  visible: boolean
  token?: TokenDetail['token']
}) {
  if (token) {
    return (
      <div className="wrap page">
        <div className="title-block">
          <BackLink to="/pools" label="Pools" />
          <h1 className="h1">{token.symbol}</h1>
          <div className="subline">
            <span>{token.name}</span>
          </div>
        </div>
        <SkeletonGroup label="Loading token" hidden={!visible} className="answer-block">
          <Rest titled />
        </SkeletonGroup>
      </div>
    )
  }
  return (
    <div className="wrap page">
      <div className="title-block">
        <BackLink to="/pools" label="Pools" />
        <SkeletonGroup label="Loading token" hidden={!visible}>
          <Skeleton height={39} width="8ch" />
          <Skeleton height={20} width="min(100%, 200px)" />
          <Rest titled={false} />
        </SkeletonGroup>
      </div>
    </div>
  )
}
