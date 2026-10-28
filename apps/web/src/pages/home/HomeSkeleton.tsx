/**
 * Home's loading skeletons (ST1, M10, docs/design/visual-v4.md §5.12): static blocks at the final
 * sizes, white at 14 % on the band and on the ink block, `--surface-2` elsewhere, so nothing moves
 * when the data lands (CLS 0). Under 300 ms they hold their space but stay invisible (`waiting`);
 * once shown, `useDelayedPending` keeps them at least 400 ms. Each one is a busy region, so the
 * first view waits for the content rather than playing over a skeleton.
 */
import { Skeleton, SkeletonGroup } from '../../components/ui/States.js'

const hidden = (waiting: boolean) => (waiting ? ' is-waiting' : '')

/** One text line at its parent's line height, as a block a little shorter than the line. */
function Line({ width }: { width: string }) {
  return (
    <span className="hs-line">
      <Skeleton height="100%" width={width} />
    </span>
  )
}

/**
 * Inside the heading: the figure at `--t-mega` and the sentence's two lines at `--t-say`. With
 * `lead`, the lead's three lines at `--t-lead` instead.
 */
export function HeroSkeleton({ waiting, lead = false }: { waiting: boolean; lead?: boolean }) {
  if (lead)
    return (
      <span className={`lead hs-lead${hidden(waiting)}`} aria-hidden="true">
        <Line width="100%" />
        <Line width="100%" />
        <Line width="58%" />
      </span>
    )
  return (
    <>
      <span className={`mega hs-fig${hidden(waiting)}`} aria-hidden="true">
        <Line width="2.9em" />
      </span>
      <span className={`say hs-say${hidden(waiting)}`} aria-hidden="true">
        <Line width="8.4em" />
        <Line width="7.4em" />
      </span>
    </>
  )
}

/** Sell and buy widths of the placeholder rows, as fractions of a side. */
const ROWS: ReadonlyArray<readonly [number, number]> = [
  [0.43, 0.61],
  [0.06, 0.15],
  [0.04, 0.05],
  [0.03, 0.04],
  [0.03, 0.04],
  [0.02, 0.03],
  [0.02, 0.03],
  [0.01, 0.01],
]

/**
 * The butterfly's frame on the band: the head with its two totals, the total row, the bracket's
 * line, eight rows around the spine, the axis and the foot row, each at its drawn height.
 */
export function ButterflySkeleton({ waiting }: { waiting: boolean }) {
  return (
    <SkeletonGroup
      className="home-skel-bf"
      label="Loading the depth of Base’s pools"
      hidden={waiting}
    >
      <span className="hsb-head">
        <Skeleton height={32} width={124} className="s" />
        <Skeleton height={32} width={124} />
      </span>
      <span className="hsb-row hsb-total">
        <span className="hsb-side s">
          <Skeleton height="var(--toth)" width="71%" />
        </span>
        <span className="hsb-side">
          <Skeleton height="var(--toth)" width="100%" />
        </span>
      </span>
      <span className="hsb-call" />
      {ROWS.map(([sell, buy]) => (
        <span key={`${sell}-${buy}`} className="hsb-row">
          <span className="hsb-side s">
            <Skeleton height="var(--barh)" width={`max(2px, ${sell * 100}%)`} />
          </span>
          <span className="hsb-side">
            <Skeleton height="var(--barh)" width={`max(2px, ${buy * 100}%)`} />
          </span>
        </span>
      ))}
      <span className="hsb-axis" />
      <span className="hsb-foot" />
    </SkeletonGroup>
  )
}

const FACT_SPANS = ['c5', 'c4', 'c3'] as const

/** The three fact blocks over the band (one ink block of rows on phones), at their final sizes. */
export function FactsSkeleton({ waiting }: { waiting: boolean }) {
  return (
    <SkeletonGroup className="home-skel-facts" label="Loading the key facts" hidden={waiting}>
      <div className="grid home-facts">
        {FACT_SPANS.map((span, i) => (
          <div
            key={span}
            className={`blk blk--over fact-blk ${span}${i === 0 ? ' ink' : ''}`}
            aria-hidden="true"
          >
            <Skeleton height={12} width="10ch" />
            <Skeleton height="var(--hsf-v)" width="3.6em" className="hsf-value" />
            <Skeleton height={15} width="80%" />
            <Skeleton height={15} width="52%" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  )
}
