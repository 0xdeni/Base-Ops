/**
 * The snapshot line (docs/design/visual-v3.md §5.1, web-v2.md §4): in the demo line's slot, a
 * static build of a `live` bundle says that the page is a snapshot of Base mainnet, when it was
 * read (UTC, with the year, since it may be read much later) and that it does not update. Below
 * 840 px a shorter sentence keeps it on one line, and below 360 px it drops the year (both
 * popovers keep it). "About this snapshot" opens the exporter's note (`depthwatch export --note`)
 * with the block and the export time.
 */
import type { StaticSnapshot } from '../../api/static.js'
import { clockTime, dated, day, group, NB, year } from '../../lib/format.js'
import { Popover } from '../ui/Popover.js'

/** Shown in the popover when the bundle was exported without `--note`. */
export const DEFAULT_SNAPSHOT_NOTE =
  'Every number was read from Base mainnet by the Depthwatch pipeline and exported to this static copy.'

/** The note's paragraphs: a blank line separates two. */
export function noteParagraphs(note: string): string[] {
  return note
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/** "Read at block 53,063,332. Exported 25 Oct 2026, 08:16 UTC." (no block before any snapshot). */
export function snapshotFacts(snapshot: StaticSnapshot): string {
  const exported = `Exported ${dated(snapshot.exportedAt)}.`
  return snapshot.block === null ? exported : `Read at block ${group(snapshot.block)}. ${exported}`
}

export function SnapshotLine({ snapshot }: { snapshot: StaticSnapshot }) {
  const at = dated(snapshot.at)
  const time = `${clockTime(snapshot.at)}${NB}UTC`
  const paragraphs =
    snapshot.note === null ? [DEFAULT_SNAPSHOT_NOTE] : noteParagraphs(snapshot.note)
  return (
    <div className="demo-line" role="note" aria-label="Data source">
      <div className="wrap demo-inner">
        <span className="snap-text">
          <span className="snap-wide">
            Snapshot of Base mainnet, {at}. This page does not update.
          </span>
          <span className="snap-narrow">
            Snapshot of {day(snapshot.at)}
            <span className="snap-year">{`${NB}${year(snapshot.at)}`}</span>, {time}, not live
          </span>
        </span>
        <Popover
          label="About this snapshot"
          triggerLabel="About this snapshot"
          trigger={
            <>
              About<span className="snap-more"> this snapshot</span>
            </>
          }
          triggerClassName="quiet-link touch-hit"
          className="pop-note"
        >
          {paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="pop-meta">{snapshotFacts(snapshot)}</p>
        </Popover>
      </div>
    </div>
  )
}
