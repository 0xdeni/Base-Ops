/**
 * Loading states of the list screens (ST1, M10): nothing for the first 300 ms, then static `well`
 * blocks at the final heights (an answer line, 64 px rows), so nothing shifts when data lands.
 * Before the delay passes the blocks are reserved but invisible.
 */
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'

/** One line of the `--t-h2` answer. */
export function AnswerSkeleton({ waiting, width = '62%' }: { waiting: boolean; width?: string }) {
  return (
    <div className="answer answer-block lists-skel-answer" aria-hidden="true">
      <Skeleton height="0.9em" width={width} style={waiting ? { opacity: 0 } : undefined} />
    </div>
  )
}

/** `rows` 64 px rows under a 40 px header (Pools) or a ruled list (Gaps). */
export function RowsSkeleton({
  waiting,
  rows = 6,
  label = 'Loading pools',
  header = true,
}: {
  waiting: boolean
  rows?: number
  label?: string
  /** Leave room for the table's 40 px header (Pools); a row list has none (Gaps). */
  header?: boolean
}) {
  return (
    <div
      className={`lists-skel-rows${header ? ' has-header' : ''}`}
      style={waiting ? { opacity: 0 } : undefined}
    >
      <SkeletonGroup label={label}>
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholder rows
          <span key={i} className="lists-skel-row">
            <Skeleton height={14} width="min(220px, 45%)" />
            <Skeleton height={13} width="min(160px, 30%)" />
          </span>
        ))}
      </SkeletonGroup>
    </div>
  )
}
