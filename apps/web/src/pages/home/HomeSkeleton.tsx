/**
 * Home's loading skeletons (ST1, M10, docs/design/visual-v3.md §5.12): static `well` blocks at the
 * final sizes, so nothing moves when the data lands (CLS 0). Under 300 ms they hold their space
 * but stay invisible (`waiting`); once shown, `useDelayedPending` keeps them at least 400 ms.
 */
import { Skeleton } from '../../components/ui/States.js'

const hidden = (waiting: boolean) => (waiting ? ' is-waiting' : '')

/** Line widths of a text block: full lines, then a shorter last one. */
const LINES = ['l1', 'l2', 'l3'] as const

/** Text lines at the line height of their parent (the display answer, a lead). */
export function LineSkeleton({ lines, waiting }: { lines: 2 | 3; waiting: boolean }) {
  return (
    <span className={`home-skel-lines${hidden(waiting)}`} aria-hidden="true">
      {LINES.slice(0, lines).map((key, i) => (
        <span key={key} className="home-skel-line">
          <Skeleton height="100%" width={i === lines - 1 ? '62%' : '100%'} />
        </span>
      ))}
    </span>
  )
}

export function LeadSkeleton({ waiting }: { waiting: boolean }) {
  return (
    <p className="lead">
      <LineSkeleton lines={3} waiting={waiting} />
    </p>
  )
}

/** Sell and buy widths of the placeholder rows, as fractions of a side. */
const ROWS: ReadonlyArray<readonly [number, number]> = [
  [0.46, 0.55],
  [0.21, 0.27],
  [0.16, 0.22],
  [0.17, 0.2],
  [0.06, 0.07],
  [0.01, 0.01],
]

/**
 * The butterfly's frame: rows of 14 px bars (10 px on phones) around the spine, the total, and the
 * space of the axis and the Show data row.
 */
export function ButterflySkeleton({ waiting }: { waiting: boolean }) {
  return (
    <div
      className={`home-skel-bfly${hidden(waiting)}`}
      role="status"
      aria-label="Loading the depth of Base’s pools"
    >
      <span className="hsb-head" />
      {ROWS.map(([sell, buy]) => (
        <span key={`${sell}-${buy}`} className="hsb-row">
          <span className="hsb-side sell">
            <Skeleton height="var(--barh)" width={`${sell * 100}%`} />
          </span>
          <span className="hsb-mid" />
          <span className="hsb-side buy">
            <Skeleton height="var(--barh)" width={`${buy * 100}%`} />
          </span>
        </span>
      ))}
      <span className="hsb-row hsb-total">
        <span className="hsb-side sell">
          <Skeleton height="var(--toth)" width="82%" />
        </span>
        <span className="hsb-mid" />
        <span className="hsb-side buy">
          <Skeleton height="var(--toth)" width="100%" />
        </span>
      </span>
      <span className="hsb-axis" />
      <span className="hsb-foot" />
    </div>
  )
}

/** Three facts: 40 px value blocks over 13 px labels. */
export function FactsSkeleton({ waiting }: { waiting: boolean }) {
  return (
    <div
      className={`facts is-rows home-facts${hidden(waiting)}`}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="home-skel-fact">
          <Skeleton height={40} width="5.5ch" />
          <Skeleton height={13} width="12ch" />
        </span>
      ))}
    </div>
  )
}
