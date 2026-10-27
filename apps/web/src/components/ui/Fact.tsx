/**
 * Facts (D3, docs/design/visual-v3.md §5.6): value first, label second, no icons, no boxes. The
 * label carries the comparison ("sell side now, below the $50K KPI"). A grade glyph or a breached
 * triangle follows the value at 12 px; the scorecard's bullet variant puts a bullet graph under it.
 */
import type { HealthGrade } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { GradeGlyph } from './GradeGlyph.js'
import { BreachMark } from './StatusWord.js'

/** `home`: rows with hairlines on phones; `pool`: 2 × 2 on phones; `scorecard`: one column. */
export type FactsLayout = 'home' | 'pool' | 'scorecard'

const LAYOUT_CLASS: Readonly<Record<FactsLayout, string>> = {
  home: 'is-rows',
  pool: 'is-grid',
  scorecard: 'is-stack',
}

export function Facts({
  layout = 'pool',
  label,
  className,
  children,
}: {
  layout?: FactsLayout
  /** Accessible name of the list, when the page has more than one. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <dl
      className={`facts ${LAYOUT_CLASS[layout]}${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {children}
    </dl>
  )
}

export function Fact({
  value,
  label,
  grade,
  breached,
  breachedLabel,
  bullet,
}: {
  value: ReactNode
  label: ReactNode
  grade?: HealthGrade | null
  /** Adds the 10 px triangle after the value. */
  breached?: boolean
  /** The triangle's accessible name; "Below KPI" by default. */
  breachedLabel?: string
  /** A bullet graph 8 px under the value (scorecard facts). */
  bullet?: ReactNode
}) {
  const mark = (
    <>
      {grade ? <GradeGlyph grade={grade} size="fact" /> : null}
      {breached ? <BreachMark label={breachedLabel} /> : null}
    </>
  )
  return (
    <div className="fact">
      <dt>{label}</dt>
      {bullet ? (
        <dd className="has-bullet">
          <span className="fv">
            <span className="num">{value}</span>
            {mark}
          </span>
          {bullet}
        </dd>
      ) : (
        <dd>
          <span className="num">{value}</span>
          {mark}
        </dd>
      )}
    </div>
  )
}
