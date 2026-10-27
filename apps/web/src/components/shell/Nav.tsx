/**
 * Primary navigation (K3, docs/design/visual-v3.md §5.1): one <nav> landmark, restyled per
 * breakpoint (inline on desktop, a 44 px tab strip on phones). The current item is text-1 with
 * `aria-current="page"` and a 2 px indicator placed with `translateX(x) scaleX(width)`, which
 * slides over 200 ms `--ease-in-out` after a pointer navigation and moves instantly otherwise.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'

/** Primary navigation, in order. Pools stays current on `/pools/:id` and token pages. */
export const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; also?: RegExp }> = [
  { to: '/pools', label: 'Pools', also: /^\/tokens\// },
  { to: '/gaps', label: 'Gaps' },
  { to: '/mm', label: 'Scorecards' },
  { to: '/methodology', label: 'Methodology' },
]

/** Whether `item` is the current section for `pathname` (its own path, a child, or `also`). */
export function isCurrent(item: (typeof NAV_ITEMS)[number], pathname: string): boolean {
  return (
    pathname === item.to || pathname.startsWith(`${item.to}/`) || item.also?.test(pathname) === true
  )
}

export function Nav({ animate }: { animate: boolean }) {
  const navRef = useRef<HTMLElement | null>(null)
  const indRef = useRef<HTMLSpanElement | null>(null)
  const placed = useRef(false)
  const { pathname } = useLocation()

  const place = useCallback((animated: boolean) => {
    const nav = navRef.current
    const ind = indRef.current
    if (!nav || !ind) return
    const cur = nav.querySelector<HTMLElement>('a[aria-current="page"]')
    if (!cur) {
      ind.classList.remove('is-on')
      placed.current = false
      return
    }
    // The first placement, keyboard and Back/Forward moves, and resizes never slide.
    const slide = animated && placed.current
    if (!slide) nav.setAttribute('data-instant', '')
    const n = nav.getBoundingClientRect()
    // The indicator spans the label, not the link's focus padding.
    const r = (cur.querySelector('.nav-label') ?? cur).getBoundingClientRect()
    const x = r.left - n.left + nav.scrollLeft
    ind.style.transform = `translateX(${x}px) scaleX(${r.width})`
    ind.classList.add('is-on')
    placed.current = true
    // Keep the current tab in view where the strip scrolls (below 360 px).
    const pad = Number.parseFloat(getComputedStyle(nav).paddingRight) || 0
    if (r.right > n.right - pad) nav.scrollLeft += r.right - (n.right - pad)
    else if (r.left < n.left + pad) nav.scrollLeft -= n.left + pad - r.left
    if (!slide && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => navRef.current?.removeAttribute('data-instant')),
      )
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place on every route change
  useLayoutEffect(() => {
    place(animate)
  }, [pathname, place])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => place(false))
    ro.observe(nav)
    return () => ro.disconnect()
  }, [place])

  return (
    <nav ref={navRef} className="nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={isCurrent(item, pathname) ? 'page' : undefined}
        >
          <span className="nav-label">{item.label}</span>
        </Link>
      ))}
      <span ref={indRef} className="nav-ind" aria-hidden="true" />
    </nav>
  )
}
