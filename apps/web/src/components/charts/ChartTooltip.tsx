/**
 * The chart tooltip (CH2, docs/design/visual-v4.md §5.10): at most 300 px, padding 10 / 12, radius
 * 12, Gray 100 with white text (Gray 80 in dark), 13 px, plane 3, `pointer-events: none`; rows of
 * a label and a tabular value. It follows the pointer 1:1 and snaps to measured points; it never
 * animates. It sits 18 px beside its point on the `prefer` side, flips when it would overflow, and
 * is vertically centred on the point. Rendered in a portal, outside <main>.
 */
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** The gap between a point and its tooltip. */
export const TIP_GAP = 18

/**
 * Viewport position of a `tw` × `th` tooltip beside the point (`x`, `y`, viewport px): 18 px to the
 * `prefer` side, the other side when that would leave the viewport, centred vertically, 8 px from
 * every viewport edge.
 */
export function placeChartTip(
  x: number,
  y: number,
  tw: number,
  th: number,
  viewport: { width: number; height: number },
  prefer: 'left' | 'right' = 'right',
): { left: number; top: number } {
  const right = x + TIP_GAP
  const left = x - tw - TIP_GAP
  let tx = prefer === 'left' ? left : right
  if (tx < 8) tx = right
  if (tx + tw > viewport.width - 8) tx = left
  tx = Math.max(8, Math.min(tx, viewport.width - tw - 8))
  const ty = Math.max(8, Math.min(y - th / 2, viewport.height - th - 8))
  return { left: tx, top: ty }
}

export interface ChartTipRow {
  key: string
  label: ReactNode
  value: ReactNode
}

export function ChartTooltip({
  x,
  y,
  prefer = 'right',
  swatch,
  title,
  rows,
}: {
  /** The point in viewport coordinates. */
  x: number
  y: number
  prefer?: 'left' | 'right'
  /** The side colour of the swatch in the header. */
  swatch?: 'sell' | 'buy'
  title: ReactNode
  rows: readonly ChartTipRow[]
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const p = placeChartTip(
      x,
      y,
      el.offsetWidth,
      el.offsetHeight,
      { width: window.innerWidth, height: window.innerHeight },
      prefer,
    )
    el.style.left = `${p.left}px`
    el.style.top = `${p.top}px`
  })
  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} className="tip is-chart chart-tip" aria-hidden="true">
      <div className="tt-h">
        {swatch ? <span className={`sw ${swatch}`} /> : null}
        {title}
      </div>
      {rows.map((r) => (
        <div className="tt-row" key={r.key}>
          <span className="tt-k">{r.label}</span>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}
