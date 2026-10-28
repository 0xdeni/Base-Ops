/**
 * The filled status chip (docs/design/visual-v4.md §5.5): the scorecard's own page only. 32 px,
 * radius 9, 15 px / 800, the shape and the word in Gray 100 on the Red fill (Green within KPI);
 * 28 px in the phone meta line (`compact`).
 */
import type { ScorecardStatus } from '@depthwatch/core'
import { Shape } from './Icon.js'
import { STATUS_WORD, statusShape, statusTone } from './StatusWord.js'

export function StatusChip({
  status,
  compact = false,
  label,
}: {
  status: ScorecardStatus
  compact?: boolean
  label?: string
}) {
  return (
    <span className={`status-chip tone-${statusTone(status)}${compact ? ' is-compact' : ''}`}>
      <Shape shape={statusShape(status)} />
      {label ?? STATUS_WORD[status]}
    </span>
  )
}
