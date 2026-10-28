/**
 * The wrapper of a dense table (Details, Show data, Compare DEXes, the Scorecards table view;
 * docs/design/visual-v4.md §5.8). A table wider than its column scrolls inside it, never the page;
 * on phones it bleeds to the screen edges and, only while the table overflows (`is-over`), its
 * first column stays put and the trailing edge fades, so a clipped cell reads as "scrolls" rather
 * than "cut off" (tables.css).
 */
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

/**
 * Whether the wrapper's content is wider than the wrapper (re-measured on resize), and whether it
 * is scrolled to its end, where the fade would only hide the last column.
 */
function useScrollsX(ref: { current: HTMLElement | null }): { over: boolean; end: boolean } {
  const [state, setState] = useState({ over: false, end: false })
  useLayoutEffect(() => {
    const wrap = ref.current
    if (!wrap) return
    const measure = () => {
      const over = wrap.scrollWidth > wrap.clientWidth + 1
      const end = over && wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1
      setState((s) => (s.over === over && s.end === end ? s : { over, end }))
    }
    measure()
    wrap.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(wrap)
    if (wrap.firstElementChild) ro?.observe(wrap.firstElementChild)
    return () => {
      wrap.removeEventListener('scroll', measure)
      ro?.disconnect()
    }
  }, [ref])
  return state
}

export function TableScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { over, end } = useScrollsX(ref)
  return (
    <div
      ref={ref}
      className={`tbl-scroll${over ? ' is-over' : ''}${end ? ' is-end' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
