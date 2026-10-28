/**
 * The uptime strip (CH8, docs/design/visual-v4.md §5.9.7): one cell per sample in the window, 40 px
 * high with radius 6 and 6 px gaps. Within-KPI cells are ink, breached cells Red, cells that could
 * not be checked hollow (a 2 px `--line-2` edge). Times sit under the cells when each has room,
 * else the first and last sample's; a legend names the three kinds. When the window holds more
 * samples than the strip has room for (30 d on a phone), neighbouring samples share a cell, which
 * is breached when any of them was: a breach is never averaged away. In list rows (`axis` off) the
 * strip is a 12 px glyph without times or legend.
 */
import { type ReactNode, useRef } from 'react'
import type { MmSampleDto } from '../../api/types.js'
import { clockTime, full } from '../../lib/format.js'
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

export interface StripLayout {
  cells: StripCell[]
  /** 6 px between roomy cells, 2 px once the strip is dense. */
  gap: number
  dense: boolean
}

/** A roomy cell is at least this wide; a dense one at least 3 px. */
const ROOMY_PX = 10
const DENSE_PX = 3

function group(
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi'>[],
  per: number,
): StripCell[] {
  const out: StripCell[] = []
  for (let i = 0; i < points.length; i += per) {
    const g = points.slice(i, i + per)
    const first = g[0]
    const last = g[g.length - 1]
    if (!first || !last) continue
    const kind: StripKind = g.some((p) => p.withinKpi === false)
      ? 'bad'
      : g.some((p) => p.withinKpi === true)
        ? 'ok'
        : 'none'
    out.push({ kind, from: first.timestamp, to: last.timestamp, samples: g.length })
  }
  return out
}

/** The strip's cells for a `widthPx`-wide strip: one per sample, or groups of neighbours. */
export function stripLayout(
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi'>[],
  widthPx: number,
): StripLayout {
  const roomy = Math.floor((widthPx + 6) / (ROOMY_PX + 6))
  if (points.length <= roomy) return { cells: group(points, 1), gap: 6, dense: false }
  const room = Math.max(1, Math.floor((widthPx + 2) / (DENSE_PX + 2)))
  return { cells: group(points, Math.max(1, Math.ceil(points.length / room))), gap: 2, dense: true }
}

/** "36 of 84 samples within KPI": the evaluable samples only, as the uptime counts them. */
export function stripLabel(points: readonly Pick<MmSampleDto, 'withinKpi'>[]): string {
  const evaluable = points.filter((p) => p.withinKpi !== null).length
  const within = points.filter((p) => p.withinKpi === true).length
  const unpriced = points.length - evaluable
  return `${within} of ${evaluable} samples within KPI${unpriced ? `, ${unpriced} not evaluable` : ''}`
}

const KIND_CLASS: Record<StripKind, string> = { ok: 'ok', bad: 'br', none: 'na' }

export function UptimeStrip({
  points,
  axis = true,
  unchecked = 'Not checkable',
  children,
}: {
  /** The window's samples, oldest first. */
  points: readonly Pick<MmSampleDto, 'timestamp' | 'withinKpi'>[]
  /** Times and the legend; off in list rows, where the strip is a 12 px glyph. */
  axis?: boolean
  /** The legend's words for a hollow cell, with its reason. */
  unchecked?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const width = useChartWidth(ref)
  const { cells, gap, dense } = stripLayout(points, width)
  const first = points[0]
  const last = points[points.length - 1]
  const cellPx = cells.length ? (width - gap * (cells.length - 1)) / cells.length : 0
  const sameDay = first && last ? last.timestamp - first.timestamp < 86_400 : false
  const eachTime = axis && !dense && sameDay && cellPx >= 44
  return (
    <>
      <div className={`strip-wrap${axis ? '' : ' is-row'}`}>
        <div
          ref={ref}
          className={`strip${dense ? ' is-dense' : ''}`}
          role="img"
          aria-label={stripLabel(points)}
          style={{ columnGap: `${gap}px` }}
        >
          {cells.map((c) => (
            <i
              key={c.from}
              className={KIND_CLASS[c.kind]}
              title={
                c.samples > 1
                  ? `${full(c.from)} to ${full(c.to)}, ${c.samples} samples`
                  : full(c.from)
              }
            />
          ))}
        </div>
        {axis && first && last ? (
          eachTime ? (
            <div className="strip-x" aria-hidden="true" style={{ columnGap: `${gap}px` }}>
              {cells.map((c) => (
                <span key={c.from}>{clockTime(c.from)}</span>
              ))}
            </div>
          ) : (
            <div className="strip-x is-ends" aria-hidden="true">
              <span>{full(first.timestamp)}</span>
              {last !== first ? <span>{full(last.timestamp)}</span> : null}
            </div>
          )
        ) : null}
        {axis ? (
          <p className="legend" aria-hidden="true">
            <span>
              <i className="sw bad" />
              Breached
            </span>
            <span>
              <i className="sw ink" />
              Within KPI
            </span>
            <span>
              <i className="sw hollow" />
              {unchecked}
            </span>
          </p>
        ) : null}
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
