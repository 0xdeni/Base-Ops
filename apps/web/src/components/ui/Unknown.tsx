/**
 * An unknown value (D6): "—" in `text-3`, never 0, whose reason opens on hover, focus or tap
 * through the glossary term. It sits above a row's stretched link, so the reason stays reachable.
 */
import { DASH } from '../../lib/format.js'
import { Glossary } from './Glossary.js'

export function Unknown({ reason }: { reason: string }) {
  return (
    <span className="dash">
      <Glossary definition={reason}>{DASH}</Glossary>
    </span>
  )
}
