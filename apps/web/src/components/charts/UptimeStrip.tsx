/**
 * The uptime strip (CH8, docs/design/visual-v3.md §5.9): one row of cells,
 * one per sample in the window, 12 px high with 2 px gaps. Within-KPI cells are `border`, breached
 * cells `--bad-mark`, unevaluable cells hollow. Each cell's title is its full UTC time; the axis
 * reads the first sample's time and "now". When the window holds more samples than the strip has
 * room for (30 d on a phone), neighbouring samples share a cell, which is breached when any of them
 * was: a breach is never averaged away.
 */
import { type ReactNode, useRef } from 'react'
import type { MmSampleDto } from '../../api/types.js'
import { full } from '../../lib/format.js'
import { ShowData } from './ShowData.js'
import { useChartWidth } from './useChartWidth.js'
import './charts.css'
import './glyphs.css'

export type StripKind = 'ok' | 'bad' | 'none'

export interface StripCell {
  kind: StripKind
  /** The cell's time, or its first and last sample's when it holds several. */
  from: number
  to: number
  samples: number
}

/** A cell needs at least this many px (its width plus the gap) to stand on its own. */
const MIN_CELL_PX = 3

/** The strip's cells for a `widthPx`-wide strip: one per sample, or groups of neighbours. */
export function stripCells(
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi'>[],
  widthPx: number,
): StripCell[] {
  const room = Math.max(1, Math.floor(widthPx / MIN_CELL_PX))
  const per = Math.max(1, Math.ceil(points.length / room))
  const out: StripCell[] = []
  for (let i = 0; i < points.length; i += per) {
    const group = points.slice(i, i + per)
    const first = group[0]
    const last = group[group.length - 1]
    if (!first || !last) continue
    const kind: StripKind = group.some((p) => p.withinKpi === false)
      ? 'bad'
      : group.some((p) => p.withinKpi === true)
        ? 'ok'
        : 'none'
    out.push({ kind, from: first.timestamp, to: last.timestamp, samples: group.length })
  }
  return out
}

/** "36 of 84 samples within KPI": the evaluable samples only, as the uptime counts them. */
export function stripLabel(points: readonly Pick<MmSampleDto, 'withinKpi'>[]): string {
  const evaluable = points.filter((p) => p.withinKpi !== null).length
  const within = points.filter((p) => p.withinKpi === true).length
  const unpriced = points.length - evaluable
  return `${within} of ${evaluable} samples within KPI${unpriced ? `, ${unpriced} not evaluable` : ''}`
}

export function UptimeStrip({
  points,
  axis = true,
  children,
}: {
  /** The window's samples, oldest first. */
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi'>[]
  /** The first-sample and "now" captions; off in list rows. */
  axis?: boolean
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const width = useChartWidth(ref)
  const cells = stripCells(points, width)
  const gap = width / Math.max(1, cells.length) >= 4 ? 2 : 1
  const first = points[0]
  return (
    <>
      <div className="strip-wrap">
        <div
          ref={ref}
          className="strip"
          role="img"
          aria-label={stripLabel(points)}
          style={{ columnGap: `${gap}px` }}
        >
          {cells.map((c) => (
            <i
              key={c.from}
              className={c.kind === 'ok' ? undefined : c.kind === 'bad' ? 'b' : 'u'}
              title={
                c.samples > 1
                  ? `${full(c.from)} to ${full(c.to)}, ${c.samples} samples`
                  : full(c.from)
              }
            />
          ))}
        </div>
        {axis && first ? (
          <div className="strip-axis" aria-hidden="true">
            <span>{full(first.timestamp)}</span>
            <span>now</span>
          </div>
        ) : null}
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
