/**
 * Home's facts (docs/design/visual-v4.md §5.6, §6.2): three single-destination blocks stacked over
 * the band's lower edge, 5 / 4 / 3 columns, each value first and its label carrying the comparison.
 * - 24 h volume, the ink block: "$191M", "traded in 24 h, 3.8× the depth within 2 % of the price"
 *   (core's turnover of the totals), and two bars on one track width: Traded and Depth ±2 %.
 * - Health: the median with its grade, "median health of the 50 rated pools", and a bar of the
 *   grade distribution sized by count, each segment in its status colour with "A 7" under it.
 * - Biggest gap: "205×", "WETH / USDT, Aerodrome CL: volume over depth", and two nested squares to
 *   scale: the outline is a day's volume, the solid square the depth within 2 %.
 * On phones the three become rows of one ink block and the micro-visuals are dropped (home.css).
 * Without a meaningful gap the third fact is the highest turnover; with no gap feed it is left out.
 */
import { computeGap, type HealthGrade, healthGrade } from '@depthwatch/core'
import type { GapItem, PoolSummary, StatsResponse } from '../../api/types.js'
import { vars } from '../../components/charts/useChartWidth.js'
import { Block } from '../../components/ui/Block.js'
import { Fact } from '../../components/ui/Fact.js'
import { count, DASH, gradeTone, NB, ratio, score, usd } from '../../lib/format.js'
import { gapLabel, healthLabel, isMeaningfulGap, volumeLabel } from './copy.js'

const GRADES: readonly HealthGrade[] = ['A', 'B', 'C', 'D', 'F']

/** The side of the outline square of the biggest gap, in px. */
export const NEST_PX = 72

const pct = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(2)}%`

/** How many rated pools hold each grade, best first; grades no pool holds are left out. */
export function gradeCounts(pools: readonly PoolSummary[]): { grade: HealthGrade; n: number }[] {
  return GRADES.map((grade) => ({
    grade,
    n: pools.filter((p) => p.health.grade === grade).length,
  })).filter((g) => g.n > 0)
}

/**
 * The two squares of a gap, areas to scale: the larger of a day's volume and the depth is the
 * full square, the other a side √ of their ratio. Returns [outline, solid] sides in px.
 */
export function nestSides(turnover: number): [number, number] {
  if (!(turnover > 0)) return [NEST_PX, 0]
  if (turnover >= 1) return [NEST_PX, NEST_PX / Math.sqrt(turnover)]
  return [NEST_PX * Math.sqrt(turnover), NEST_PX]
}

/** Traded and Depth ±2 % as two bars on one track width: the larger of the two fills it. */
function VolumeBars({ volume, depth }: { volume: number; depth: number }) {
  const top = Math.max(volume, depth)
  if (!(top > 0)) return null
  return (
    <span className="hf-vs" aria-hidden="true">
      <span className="hf-track">
        <i data-bar="" style={{ width: pct(volume / top) }} />
      </span>
      <span className="cap">Traded</span>
      <span className="hf-track">
        <i data-bar="" style={{ width: pct(depth / top) }} />
      </span>
      <span className="cap">Depth ±2{NB}%</span>
    </span>
  )
}

type GradeCount = ReturnType<typeof gradeCounts>[number]

/** "A 7, B 18, C 9, D 13, F 3" */
const countsText = (counts: readonly GradeCount[]) =>
  counts.map((g) => `${g.grade} ${count(g.n)}`).join(', ')

/** The grade distribution of the rated pools, one segment per grade sized by its count. */
function GradeSpread({ counts }: { counts: readonly GradeCount[] }) {
  if (!counts.length) return null
  return (
    <span className="hf-gd" aria-hidden="true">
      {counts.map((g) => (
        <span key={g.grade} style={{ flexGrow: g.n }}>
          <i data-bar="" className={`tone-${gradeTone(g.grade)}`} />
          <span className="cap">
            {g.grade} {count(g.n)}
          </span>
        </span>
      ))}
    </span>
  )
}

function GapSquares({ turnover }: { turnover: number }) {
  const [outline, solid] = nestSides(turnover)
  return (
    <span className="hf-nest" aria-hidden="true">
      <span className="hf-box" style={vars({ '--out': `${outline.toFixed(2)}px` })}>
        <i style={vars({ '--in': `${solid.toFixed(2)}px` })} />
      </span>
      <span className="cap">Outline: a day’s volume. Solid: depth ±2{NB}%. Area to scale.</span>
    </span>
  )
}

export function HomeFacts({
  totals,
  top,
  pools,
}: {
  totals: StatsResponse['totals']
  /** The top of the gap feed (the highest turnover), when the feed has one. */
  top: GapItem | undefined
  /** Every scored pool, for the grade distribution; undefined when they could not be read. */
  pools: readonly PoolSummary[] | undefined
}) {
  const turnover = computeGap(totals.volume24hUsd, totals.depth2Usd).turnoverRatio
  const median = totals.medianHealth
  const topRatio = top?.gap.turnoverRatio ?? null
  const counts = pools && totals.rated > 0 ? gradeCounts(pools) : []
  const volume = { eyebrow: `24${NB}h volume`, label: volumeLabel(turnover) }
  const health = { eyebrow: 'Health', label: healthLabel(totals.rated) }
  const grade = median === null ? null : healthGrade(median)
  // Each block is one link; its name reads in the visual order: eyebrow, value, label.
  const healthName =
    median === null
      ? `${health.eyebrow}: ${health.label}`
      : `${health.eyebrow}: ${score(median)}, grade ${grade}, ${health.label}${counts.length ? `. Grades: ${countsText(counts)}` : ''}`
  const gap =
    top && topRatio !== null
      ? {
          eyebrow: isMeaningfulGap(top) ? 'Biggest gap' : 'Highest turnover',
          value: ratio(topRatio),
          label: gapLabel(top),
        }
      : null
  return (
    <div className="grid home-facts">
      <Block
        variant="ink"
        over
        span={5}
        to="/pools?sort=volume"
        linkLabel={`${volume.eyebrow}: ${usd(totals.volume24hUsd)}, ${volume.label}`}
        className="fact-blk"
      >
        <dl className="facts">
          <Fact eyebrow={volume.eyebrow} value={usd(totals.volume24hUsd)} label={volume.label} />
        </dl>
        {totals.volume24hUsd !== null ? (
          <VolumeBars volume={totals.volume24hUsd} depth={totals.depth2Usd} />
        ) : null}
      </Block>
      <Block
        over
        span={gap ? 4 : 7}
        to="/pools?sort=health"
        linkLabel={healthName}
        className="fact-blk"
      >
        <dl className="facts">
          <Fact
            eyebrow={health.eyebrow}
            value={median === null ? DASH : score(median)}
            grade={grade}
            label={health.label}
          />
        </dl>
        <GradeSpread counts={counts} />
      </Block>
      {gap && topRatio !== null ? (
        <Block
          over
          span={3}
          to="/gaps"
          linkLabel={`${gap.eyebrow}: ${gap.value}, ${gap.label}`}
          className="fact-blk"
        >
          <dl className="facts">
            <Fact eyebrow={gap.eyebrow} value={gap.value} label={gap.label} />
          </dl>
          <GapSquares turnover={topRatio} />
        </Block>
      ) : null}
    </div>
  )
}
