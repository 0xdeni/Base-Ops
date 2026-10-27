/**
 * The filled status chip (K5, §5.5): the scorecard's own page only, where it is the subject and
 * the one filled element. 24 px high; 22 px in the phone meta line (`compact`).
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
