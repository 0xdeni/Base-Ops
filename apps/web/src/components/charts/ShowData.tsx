/**
 * The foot row under a figure (CH9, docs/design/visual-v4.md §5.9): "Show data" at left, which
 * becomes "Hide data" while open, and the chart's caption at right; the table opens under the
 * whole row. On the band the table sits in a white block (black in dark), so a dense table never
 * draws on Blue. Without a table the row holds the caption alone.
 */
import type { ReactNode } from 'react'
import { DisclosurePanel, DisclosureTrigger, useDisclosure } from '../ui/Disclosure.js'

export function ShowData({
  children,
  className,
  band = false,
  note,
}: {
  /** The table (and its takeaway); nothing to disclose without it. */
  children?: ReactNode
  className?: string
  /** The figure sits on the band: the table opens in a surface block. */
  band?: boolean
  /** The caption at the right of the row ("One scale for every pool."). */
  note?: ReactNode
}) {
  const state = useDisclosure()
  const has = children !== undefined && children !== null && children !== false
  if (!has && !note) return null
  return (
    <div
      className={`chart-foot${band ? ' on-band' : ''}${className ? ` ${className}` : ''}`}
      data-furniture={band ? '' : undefined}
    >
      <div className="chart-foot-row">
        {has ? <DisclosureTrigger state={state} label="Show data" openLabel="Hide data" /> : null}
        {note ? <p className="cap chart-cap">{note}</p> : null}
      </div>
      {has ? (
        <DisclosurePanel state={state}>
          {band ? <div className="band-data">{children}</div> : children}
        </DisclosurePanel>
      ) : null}
    </div>
  )
}
