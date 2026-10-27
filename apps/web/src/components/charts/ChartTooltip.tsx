/**
 * The tooltip of snapshot charts (CH2, docs/design/visual-v3.md §5.9 "Tooltip", §4 row 21): min
 * 150 px, padding 8 / 10, radius 10, `overlay` with `--shadow-pop`, 13 px, `pointer-events: none`.
 * It follows the pointer 1:1 and snaps to measured points; it never animates. It sits 16 px beside
 * its point, on the side away from the direct label (`prefer`), flips when it would overflow, and
 * is vertically centred on the point. Rendered in a portal, outside <main>.
 */
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Viewport position of a `tw` × `th` tooltip beside the point (`x`, `y`, viewport px): 16 px to the
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
  const right = x + 16
  const left = x - tw - 16
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
  /** The side colour of the 8 px swatch in the header. */
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
    <div ref={ref} className="tip is-chart" aria-hidden="true">
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
