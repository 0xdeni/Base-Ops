/**
 * An unknown value (D6): "—" in `--text-2`, never 0. It is not a tab stop, so a long table of
 * unknowns adds none: its reason is its accessible name ("Unknown: …") and its hover tooltip, and
 * it sits above a row's stretched link so the tooltip stays reachable. A table column that shows
 * one gives the reasons once in its header (`UnknownNote`), a glossary term that opens on focus
 * or tap.
 */
import { DASH } from '../../lib/format.js'
import { Glossary } from './Glossary.js'

export function Unknown({ reason }: { reason: string }) {
  return (
    <span className="dash" role="img" aria-label={`Unknown: ${reason}`} title={reason}>
      {DASH}
    </span>
  )
}

/**
 * The "—" of a column, explained once in its header: a glossary term over each distinct reason
 * its rows give (null for a row with a value). Nothing when no row shows "—".
 */
export function UnknownNote({ reasons }: { reasons: readonly (string | null)[] }) {
  const distinct = [...new Set(reasons.filter((r): r is string => r !== null))]
  if (!distinct.length) return null
  return (
    <Glossary definition={distinct.join(' ')} className="th-note">
      <span aria-hidden="true">{DASH}</span>
      <span className="sr-only">Why some values are unknown</span>
    </Glossary>
  )
}
