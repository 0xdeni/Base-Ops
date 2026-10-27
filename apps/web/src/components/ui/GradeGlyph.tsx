/**
 * The grade glyph (C4, K5, docs/design/visual-v3.md §5.5): a fixed 28 × 20 tinted chip with the
 * band's shape and the letter, readable in greyscale. 32 × 24 in facts. The one chip per row (TB5).
 */
import type { HealthGrade, UnratedReason } from '@depthwatch/core'
import { gradeTone } from '../../lib/format.js'
import { NOT_RATED, unratedDetail } from '../../lib/rating.js'
import { Glossary } from './Glossary.js'
import { Shape, type ShapeName } from './Icon.js'

const SHAPE_OF = { ok: 'circle', warn: 'square', bad: 'triangle' } as const satisfies Record<
  string,
  ShapeName
>

export function GradeGlyph({
  grade,
  size = 'row',
  label,
}: {
  grade: HealthGrade
  /** `row` 28 × 20 (tables, rows); `fact` 32 × 24 (facts, the Health section). */
  size?: 'row' | 'fact'
  /** Accessible name; defaults to "Grade A". */
  label?: string
}) {
  const tone = gradeTone(grade)
  return (
    <span
      className={`grade tone-${tone}${size === 'fact' ? ' is-fact' : ''}`}
      role="img"
      aria-label={label ?? `Grade ${grade}`}
    >
      <Shape shape={SHAPE_OF[tone]} />
      <span aria-hidden="true">{grade}</span>
    </span>
  )
}

/**
 * The chip of a pool with no grade: neutral, the words "Not rated" instead of a letter, and the
 * plain-words reason on hover, focus or tap ("Too thin to rate", "Too thin on one side", "No USD
 * price"). The same size as the grade glyph's row and fact variants, wider for the words.
 */
export function NotRatedChip({
  reason,
  size = 'row',
}: {
  reason: UnratedReason | null
  size?: 'row' | 'fact'
}) {
  return (
    <span className={`grade tone-none is-unrated${size === 'fact' ? ' is-fact' : ''}`}>
      <Glossary definition={unratedDetail(reason)} anchor="health" className="touch-hit">
        {NOT_RATED}
      </Glossary>
    </span>
  )
}

/** The grade glyph of a rated pool, or the "Not rated" chip with its reason (one chip per row, TB5). */
export function RatingGlyph({
  health,
  size = 'row',
}: {
  health: { grade: HealthGrade | null; rated: boolean; unratedReason: UnratedReason | null }
  size?: 'row' | 'fact'
}) {
  if (health.rated && health.grade) return <GradeGlyph grade={health.grade} size={size} />
  return <NotRatedChip reason={health.unratedReason} size={size} />
}
