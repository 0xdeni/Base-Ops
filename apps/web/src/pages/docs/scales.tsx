/**
 * Methodology's scale figures (ia-v3 §4.8): the weighted health bar with the grade bands and their
 * shapes (replacing v2's coloured chip row), and the gap score's log scale (1× to 0, 10× to 50,
 * 100× to 100). Every threshold is read from core (`healthGrade`, `computeGap`) or from the charts
 * that draw it on other screens, so the figures can never disagree with a score.
 */
import { computeGap, type HealthComponents, type HealthGrade, healthGrade } from '@depthwatch/core'
import { HealthBar } from '../../components/charts/HealthBar.js'
import { MEANINGFUL_GAP_TURNOVER } from '../../components/charts/TurnoverGlyph.js'
import { vars } from '../../components/charts/useChartWidth.js'
import { GradeGlyph } from '../../components/ui/GradeGlyph.js'
import { Figure } from './figures.js'

/** An illustrative pool: concentration is its weak part. */
const EXAMPLE: HealthComponents = { depth: 30.2, spread: 21.5, concentration: 9.4, persistence: 17 }

export interface GradeBand {
  grade: HealthGrade
  /** Lowest total of the band. */
  from: number
  /** Lowest total of the next band (100 for the top one). */
  to: number
}

/** The grade bands on the 0–100 total, scanned from core's `healthGrade`. */
export function gradeBands(): GradeBand[] {
  const bands: GradeBand[] = []
  for (let total = 0; total <= 100; total++) {
    const grade = healthGrade(total)
    const last = bands[bands.length - 1]
    if (last && last.grade === grade) last.to = Math.min(100, total + 1)
    else {
      if (last) last.to = total
      bands.push({ grade, from: total, to: Math.min(100, total + 1) })
    }
  }
  return bands
}

function bandsLabel(bands: readonly GradeBand[]): string {
  const parts = [...bands]
    .reverse()
    .map((b) => (b.from === 0 ? `${b.grade} below ${b.to}` : `${b.grade} from ${b.from}`))
  return `Grades by total score: ${parts.join(', ')}.`
}

function edgeClass(at: number): string {
  return at <= 0 ? ' is-start' : at >= 100 ? ' is-end' : ''
}

export function GradeBands() {
  const bands = gradeBands()
  const cuts = [0, ...bands.map((b) => b.to)]
  return (
    <div className="doc-grades" role="img" aria-label={bandsLabel(bands)}>
      <div
        className="doc-gb-row"
        aria-hidden="true"
        style={{ gridTemplateColumns: bands.map((b) => `${b.to - b.from}fr`).join(' ') }}
      >
        {bands.map((b) => (
          <span key={b.grade} className="doc-gb">
            <GradeGlyph grade={b.grade} />
            <i className="doc-gb-bar" />
          </span>
        ))}
      </div>
      <div className="doc-axis" aria-hidden="true">
        {cuts.map((at) => (
          <span key={at} className={`doc-tick${edgeClass(at)}`} style={vars({ '--at': at / 100 })}>
            {at}
          </span>
        ))}
      </div>
    </div>
  )
}

export function HealthFigure() {
  return (
    <>
      <Figure caption="Illustration. Each part is as wide as its weight and fills with the points it earned; the weakest part is named in full colour.">
        <HealthBar components={EXAMPLE} />
      </Figure>
      <Figure caption="The total sets the grade. Each grade keeps its shape, so it reads without colour.">
        <GradeBands />
      </Figure>
    </>
  )
}

/** Turnover ticks on the gap score's log scale, placed by core's `computeGap`. */
const TURNOVER_TICKS = [1, MEANINGFUL_GAP_TURNOVER, 10, 100] as const
const scoreAt = (turnover: number) => computeGap(turnover, 1).gapScore ?? 0
const SCORE_TICKS = [1, 10, 100].map(scoreAt)

export function GapScale() {
  const gap = scoreAt(MEANINGFUL_GAP_TURNOVER) / 100
  return (
    <Figure
      caption={`Each tenfold of turnover adds 50 points. A pool trading ${MEANINGFUL_GAP_TURNOVER}× its depth or more, about ${Math.round(gap * 100)} points, counts as a gap; the rest are drawn quiet.`}
    >
      <div
        className="doc-gap"
        role="img"
        aria-label={`Gap score by turnover: ${TURNOVER_TICKS.map((t) => `${t === 100 ? '100× or more' : `${t}×`} scores ${Math.round(scoreAt(t))}`).join(', ')}.`}
        style={vars({ '--gap': gap })}
      >
        <span className="doc-gap-k" aria-hidden="true">
          Turnover
        </span>
        <div className="doc-axis is-top" aria-hidden="true">
          {TURNOVER_TICKS.map((t) => {
            const at = scoreAt(t)
            return (
              <span
                key={t}
                className={`doc-tick${edgeClass(at)}${t === MEANINGFUL_GAP_TURNOVER ? ' is-gap' : ''}`}
                style={vars({ '--at': at / 100 })}
              >
                {t}×
              </span>
            )
          })}
        </div>
        <div className="doc-gap-track" aria-hidden="true">
          <i className="doc-gap-quiet" />
          <i className="doc-gap-fill" />
          <b className="doc-gap-tick" />
        </div>
        <span className="doc-gap-k" aria-hidden="true">
          Gap score
        </span>
        <div className="doc-axis" aria-hidden="true">
          {SCORE_TICKS.map((at) => (
            <span
              key={at}
              className={`doc-tick${edgeClass(at)}`}
              style={vars({ '--at': at / 100 })}
            >
              {Math.round(at)}
            </span>
          ))}
        </div>
      </div>
    </Figure>
  )
}
