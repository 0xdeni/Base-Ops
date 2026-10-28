/**
 * Scorecard status as a word in ink with its shape in the status colour (docs/design/visual-v4.md
 * §5.5): lists, previews and mandate rows, 14 px / 700. Red and Green are never text. The filled
 * chip is `StatusChip`, on the scorecard's own page only.
 */
import type { ScorecardStatus } from '@depthwatch/core'
import { Shape, type ShapeName } from './Icon.js'

export const STATUS_WORD: Readonly<Record<ScorecardStatus, string>> = {
  ok: 'Within KPI',
  breached: 'Breached',
  inactive: 'Inactive',
  'no-data': 'No data',
}

export function statusTone(status: ScorecardStatus): 'ok' | 'bad' | 'none' {
  if (status === 'ok') return 'ok'
  return status === 'breached' ? 'bad' : 'none'
}

export function statusShape(status: ScorecardStatus): ShapeName {
  if (status === 'ok') return 'circle'
  return status === 'breached' ? 'triangle' : 'ring'
}

export function StatusWord({ status, label }: { status: ScorecardStatus; label?: string }) {
  return (
    <span className={`status tone-${statusTone(status)}`}>
      <Shape shape={statusShape(status)} />
      {label ?? STATUS_WORD[status]}
    </span>
  )
}

/** The 10 px triangle beside a breached fact value (§5.5). */
export function BreachMark({ label = 'Below KPI' }: { label?: string }) {
  return (
    <svg className="breach-mark" viewBox="0 0 8 8" role="img" aria-label={label}>
      <path d="M4 .5L7.8 7.5H.2z" fill="currentColor" />
    </svg>
  )
}
