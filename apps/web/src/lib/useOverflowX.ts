/**
 * Whether a table is wider than its wrapper (TB7, A8): only then does the wrapper scroll sideways,
 * so a table that fits keeps its header sticky under the app bar (a scrolling wrapper would become
 * the header's scroll box). Re-measured when either box changes size.
 */
import { type RefObject, useLayoutEffect, useState } from 'react'

export function useOverflowX(
  wrapRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): boolean {
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const content = contentRef.current
    if (!wrap || !content) return
    const measure = () => setOver(content.offsetWidth > wrap.clientWidth + 1)
    measure()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    ro.observe(content)
    return () => ro.disconnect()
  }, [wrapRef, contentRef])
  return over
}
