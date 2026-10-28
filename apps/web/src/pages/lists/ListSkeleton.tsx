/**
 * Loading states of the list screens (ST1, M10, docs/design/visual-v4.md §5.12): nothing for the
 * first 300 ms, then static blocks at the final sizes, white at 14 % on the band and `--surface-2`
 * off it, so nothing shifts when data lands. Before the delay passes the blocks are reserved but
 * invisible.
 */
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'

/** The answer's lines (`--t-answer`): two on the Pools band, one beside the Gaps title. */
export function AnswerSkeleton({
  waiting,
  lines = 1,
  className = '',
}: {
  waiting: boolean
  lines?: number
  className?: string
}) {
  return (
    <div className={`answer lists-skel-answer ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholder lines
          key={i}
          height="0.8em"
          width={i === lines - 1 && lines > 1 ? '60%' : '92%'}
          style={waiting ? { opacity: 0 } : undefined}
        />
      ))}
    </div>
  )
}

/** The DEX filter's five 44 px rows on the band. */
export function DexSkeleton({ waiting }: { waiting: boolean }) {
  return (
    <div className="lists-skel-dex" style={waiting ? { opacity: 0 } : undefined} aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholder rows
        <Skeleton key={i} height={44} />
      ))}
    </div>
  )
}

/** The square field's plot, readout and caption on the band (420 px high, 260 on phones). */
export function FieldSkeleton({ waiting }: { waiting: boolean }) {
  return (
    <div className="lists-skel-field" style={waiting ? { opacity: 0 } : undefined}>
      <SkeletonGroup label="Loading the square field">
        <Skeleton height="var(--field-h)" className="lists-skel-plot" />
        <span className="lists-skel-lens" />
        <Skeleton height={13} width="min(560px, 90%)" />
        <Skeleton height={13} width="min(480px, 75%)" />
        <Skeleton height={13} width="min(400px, 60%)" />
      </SkeletonGroup>
    </div>
  )
}

/** `rows` rows of the table sheet (64 px) or of the gap list (72 px). */
export function RowsSkeleton({
  waiting,
  rows = 6,
  label = 'Loading pools',
  header = true,
}: {
  waiting: boolean
  rows?: number
  label?: string
  /** Leave room for the table's 44 px header (Pools); a row list has none (Gaps). */
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
