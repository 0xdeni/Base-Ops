/**
 * In-page anchors on Methodology (ia-v3 §2: `#depth` … `#scorecards`, `#index`). A jump is not a
 * route change (docs/design/visual-v3.md §4 row 6), so it never cross-fades <main>: plain clicks on
 * `a[data-anchor]` are taken in the window's capture phase, before the shell reads the click, then
 * pushed as a hash and scrolled to instantly (`scroll-padding-top` clears the app bar). A keyboard
 * jump moves focus to the section's heading. A new history entry with a hash scrolls to it; Back
 * and Forward to an entry seen before keep the shell's restored position. The current section is the last one whose top has passed
 * just under the app bar, or the last one at the end of the page.
 */
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { isKeyboardClick } from '../../lib/motion.js'

/** The current section's id from each section's top (px from the viewport top). */
export function pickCurrent(
  tops: ReadonlyArray<readonly [string, number]>,
  line: number,
  atEnd: boolean,
): string | null {
  if (atEnd && tops.length) return tops[tops.length - 1]?.[0] ?? null
  let current: string | null = null
  for (const [id, top] of tops) if (top <= line) current = id
  return current
}

function appBarHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--appbar-h')
  const h = Number.parseFloat(raw)
  return Number.isFinite(h) ? h : 56
}

export function useCurrentSection(ids: readonly string[]): string | null {
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    let raf = 0
    const read = () => {
      raf = 0
      const tops = ids.map((id) => {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        return [id, top ?? Number.POSITIVE_INFINITY] as const
      })
      const doc = document.documentElement
      const atEnd =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2
      setCurrent(pickCurrent(tops, appBarHeight() + 48, atEnd))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [ids])
  return current
}

/** History entries this session has shown (React Router location keys). */
const visited = new Set<string>()

/** Scrolls to the anchor's target; a keyboard jump also moves focus to its heading. */
function reveal(id: string, keyboard: boolean): void {
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView?.({ block: 'start' })
  if (!keyboard) return
  const focusable = target.querySelector<HTMLElement>('[data-jump-focus]') ?? target
  focusable.focus({ preventScroll: true })
}

/**
 * Takes over plain clicks on `a[data-anchor]` inside `root` and scrolls to `location.hash` when it
 * changes by a push or replace, and once on arrival.
 */
export function useAnchors(root: RefObject<HTMLElement | null>): void {
  const location = useLocation()
  const navType = useNavigationType()
  const navigate = useNavigate()
  const hashRef = useRef(location.hash)
  hashRef.current = location.hash
  const keyboardJump = useRef(false)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const a = e.target instanceof Element ? e.target.closest<HTMLElement>('a[data-anchor]') : null
      const id = a?.dataset.anchor
      if (!a || !id || !root.current?.contains(a)) return
      e.preventDefault()
      const keyboard = isKeyboardClick(e)
      if (hashRef.current === `#${id}`) {
        reveal(id, keyboard)
        return
      }
      keyboardJump.current = keyboard
      navigate({ hash: `#${id}` })
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [navigate, root])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per location
  useEffect(() => {
    const keyboard = keyboardJump.current
    keyboardJump.current = false
    // Back and Forward to an entry seen before keep the shell's restored position; a new entry
    // (a push, an edited hash, a first load) goes to its section.
    const revisit = navType === 'POP' && location.key !== 'default' && visited.has(location.key)
    visited.add(location.key)
    if (!location.hash || revisit) return
    let id = location.hash.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // A malformed escape: look the raw id up.
    }
    reveal(id, keyboard)
  }, [location.key])
}
