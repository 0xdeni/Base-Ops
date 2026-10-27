/**
 * Chart plumbing shared by the hand-drawn charts (docs/design/visual-v3.md §5.9): the measured
 * width of a container (ResizeObserver; charts redraw on resize, never scale), the device pixel
 * ratio the halftone lattice snaps to, and SVG-safe ids for patterns, masks and clips.
 */
import { type CSSProperties, type RefObject, useId, useLayoutEffect, useState } from 'react'

/**
 * The content width of `ref`'s element, kept current by a ResizeObserver. Measured in a layout
 * effect, so the first paint already has the real width. `fallback` is used where nothing can be
 * measured (jsdom, a hidden container), so geometry stays testable.
 */
export function useChartWidth(ref: RefObject<HTMLElement | null>, fallback = 720): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setWidth(Math.round(el.clientWidth))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width > 0 ? width : fallback
}

/** `window.devicePixelRatio`, 1 where there is no window. */
export function devicePixelRatio(): number {
  if (typeof window === 'undefined') return 1
  const dpr = window.devicePixelRatio
  return dpr > 0 && Number.isFinite(dpr) ? dpr : 1
}

/** A `useId` safe inside `url(#…)` references (React's ids carry punctuation). */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/** Custom properties for an inline style: `vars({ '--w': 0.4 })`. */
export function vars(v: Record<`--${string}`, string | number>): CSSProperties {
  return v as CSSProperties
}
