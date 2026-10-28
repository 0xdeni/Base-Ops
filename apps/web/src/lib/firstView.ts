/**
 * The first view (docs/design/visual-v4.md §4.1): the one orchestrated moment. On the first render
 * of a session, on whichever route the visitor lands, the page builds itself once: the band's
 * ground drops, the title rises, bars grow from their spine, the blocks settle over the band. Every
 * step ends by 450 ms. Route changes, Back, Forward and refetches never play it; `?replay=1`
 * replays it for review. The gate is the `sessionStorage` key `dw-first-view`, written once the
 * timeline has started; blocked storage simply plays it again.
 *
 * The steps run as Web Animations that all start from one instant, so a test (or a review tool)
 * can pause them and seek any frame. Elements opt in with attributes their page or chart sets:
 * - `.band-ground`: the band's ground layer (clipped from 60 % to full);
 * - `[data-rise]`: the title parts, in order (the figure and sentence on Home, title and answer);
 * - `[data-in]`: the eyebrow, lead and actions;
 * - `[data-bar]`: a bar that grows from its spine or baseline (`data-bar="y"` grows vertically;
 *   its `transform-origin` comes from its stylesheet). Bars inside a `[data-over]` block grow with
 *   that block, the rest with the band;
 * - `[data-over]`: a block stacked over the band;
 * - `[data-furniture]`: legends, totals, labels, axes, captions and readouts, which fade in after
 *   their marks so no value leads its mark;
 * - `[data-sq]`: a field square, largest first in document order;
 * - `[data-area]` and `[data-pt]`: the depth curve's areas (opening from the mid line) and points;
 * - `[data-chart]`: a whole chart, faded as one under reduced motion.
 * The timeline writes `transform`, so these elements are positioned with `left`, `top` or the
 * `translate` property, never their own `transform`; a square's inline transform is kept.
 *
 * Under reduced motion nothing moves: the ground, the title parts, `[data-in]`, `[data-over]` and
 * each chart fade in over 200 ms, linear, with no delay.
 */
import { type RefObject, useLayoutEffect, useRef } from 'react'
import { DUR, EASE, prefersReducedMotion } from './motion.js'

export const FIRST_VIEW_KEY = 'dw-first-view'
/** Every step of the first view ends by this time (ms). */
export const FIRST_VIEW_MS = DUR.first
/**
 * How long the landing route may take to render its data before the first view gives up (ms):
 * the delay before a skeleton shows. Until then nothing in <main> paints.
 */
export const FIRST_VIEW_WAIT_MS = 300

/** One step of the timeline, planned before anything is animated. */
export interface FirstViewStep {
  el: Element
  keyframes: Keyframe[]
  delay: number
  duration: number
  easing: string
}

/** True when this render should play the first view: a new session, or `?replay=1`. */
export function firstViewDue(...searches: string[]): boolean {
  if (searches.some((s) => new URLSearchParams(s).get('replay') === '1')) return true
  try {
    return window.sessionStorage.getItem(FIRST_VIEW_KEY) !== '1'
  } catch {
    return true
  }
}

/** Marks the first view as played for this session (a no-op where storage is blocked). */
export function markFirstView(): void {
  try {
    window.sessionStorage.setItem(FIRST_VIEW_KEY, '1')
  } catch {
    // Private mode or blocked storage: the first view plays again next time; nothing breaks.
  }
}

const all = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)]
const opacityIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }]
const rise = (px: number): Keyframe[] => [
  { opacity: 0, transform: `translateY(${px}px)` },
  { opacity: 1, transform: 'none' },
]
const grow = (el: Element): Keyframe[] => {
  const axis = el.getAttribute('data-bar') === 'y' ? 'scaleY' : 'scaleX'
  return [{ transform: `${axis}(0.001)` }, { transform: `${axis}(1)` }]
}

/** The reduced-motion version: an opacity fade of the main parts, 200 ms, linear, no delay. */
function reducedSteps(root: ParentNode): FirstViewStep[] {
  const els = new Set([
    ...all(root, '.band-ground, [data-rise], [data-in], [data-over], [data-chart]'),
  ])
  return [...els].map((el) => ({
    el,
    keyframes: opacityIn,
    delay: 0,
    duration: DUR.fade,
    easing: 'linear',
  }))
}

/** The steps of §4.1 for the elements under `root`, in the order the spec lists them. */
export function firstViewSteps(root: ParentNode, reduced: boolean): FirstViewStep[] {
  if (reduced) return reducedSteps(root)
  const out: FirstViewStep[] = []
  const add = (el: Element, keyframes: Keyframe[], delay: number, duration: number) =>
    out.push({ el, keyframes, delay, duration, easing: EASE.out })
  // 1. The band's ground: clipped from its top 60 % to full.
  for (const el of all(root, '.band-ground'))
    add(el, [{ clipPath: 'inset(0 0 40% 0)' }, { clipPath: 'inset(0 0 0 0)' }], 0, 380)
  // 2. Title parts rise 24 px, 40 ms apart.
  all(root, '[data-rise]').forEach((el, i) => add(el, rise(24), Math.min(i, 2) * 40, 360))
  // 3. Eyebrow, lead and actions rise 16 px, 30 ms apart.
  all(root, '[data-in]').forEach((el, i) => add(el, rise(16), 60 + Math.min(i, 3) * 30, 300))
  // 4. Bars on the band grow from the spine or the baseline, 10 ms apart.
  const bars = all(root, '[data-bar]')
  bars
    .filter((el) => !el.closest('[data-over]'))
    .forEach((el, i) => add(el, grow(el), 80 + Math.min(i, 10) * 10, 260))
  // 5. Blocks over the band rise 24 px; 6. the bars inside each one grow with it.
  all(root, '[data-over]').forEach((block, i) => {
    add(block, rise(24), 80 + Math.min(i, 2) * 20, 320)
    bars
      .filter((el) => el.closest('[data-over]') === block)
      .forEach((el, j) => add(el, grow(el), 100 + Math.min(j, 10) * 10, 240))
  })
  // 7. Chart furniture fades in after the marks, linear.
  for (const el of all(root, '[data-furniture]')) {
    out.push({ el, keyframes: opacityIn, delay: 260, duration: 160, easing: 'linear' })
  }
  // 8. Field squares appear largest first, scaling from 0.6.
  const squares = all(root, '[data-sq]')
  squares.forEach((el, i) => {
    const at = el instanceof HTMLElement || el instanceof SVGElement ? el.style.transform : ''
    const from = `${at} scale(0.6)`.trim()
    const to = `${at} scale(1)`.trim()
    const rank = i / Math.max(1, squares.length - 1)
    add(
      el,
      [
        { opacity: 0, transform: from },
        { opacity: 1, transform: to },
      ],
      40 + Math.round(Math.sqrt(rank) * 200),
      200,
    )
  })
  // 9. The curve's areas open from the mid line; 10. its points fade in.
  for (const el of all(root, '[data-area]'))
    add(el, [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }], 60, 320)
  for (const el of all(root, '[data-pt]')) {
    out.push({ el, keyframes: opacityIn, delay: 220, duration: 160, easing: 'linear' })
  }
  return out
}

/**
 * Starts the first view on `root` and returns its animations, all started from one instant and
 * held at their first frame during their delay. Empty where the Web Animations API is missing.
 */
export function playFirstView(
  root: ParentNode,
  { reduced = prefersReducedMotion() }: { reduced?: boolean } = {},
): Animation[] {
  const steps = firstViewSteps(root, reduced)
  const anims: Animation[] = []
  for (const s of steps) {
    if (typeof s.el.animate !== 'function') continue
    anims.push(
      s.el.animate(s.keyframes, {
        delay: s.delay,
        duration: s.duration,
        easing: s.easing,
        fill: 'backwards',
      }),
    )
  }
  const t0 = typeof document !== 'undefined' ? document.timeline?.currentTime : null
  if (t0 !== null && t0 !== undefined) for (const a of anims) a.startTime = t0
  return anims
}

/** The landing route has rendered its content: something in it, and no skeleton or busy region. */
export function isSettled(root: Element): boolean {
  return root.childElementCount > 0 && root.querySelector('.skel-stack, [aria-busy="true"]') === null
}

/**
 * The first-view gate for the app shell: once per session, for the landing route only. While the
 * route waits for its data (at most `FIRST_VIEW_WAIT_MS`), <html> carries `data-first-view="wait"`
 * and <main> does not paint; the timeline starts the moment the content is in, before it paints.
 * A route change before then cancels it, and it stays due for the next load of the session.
 */
export function useFirstView(
  rootRef: RefObject<HTMLElement | null>,
  location: { key: string; search: string },
): void {
  const landing = useRef(location.key)
  const cancel = useRef<(() => void) | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the gate runs once, for the landing route
  useLayoutEffect(() => {
    const root = rootRef.current
    const search = typeof window === 'undefined' ? '' : window.location.search
    if (!root || !firstViewDue(location.search, search)) return
    const html = document.documentElement
    let done = false
    let observer: MutationObserver | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (play: boolean) => {
      if (done) return
      done = true
      observer?.disconnect()
      clearTimeout(timer)
      if (play) {
        playFirstView(root)
        markFirstView()
      }
      html.removeAttribute('data-first-view')
    }
    cancel.current = () => finish(false)
    if (isSettled(root)) {
      finish(true)
      return
    }
    html.setAttribute('data-first-view', 'wait')
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => {
        if (isSettled(root)) finish(true)
      })
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-busy', 'class'],
      })
    }
    timer = setTimeout(() => finish(false), FIRST_VIEW_WAIT_MS)
    return () => finish(false)
  }, [])

  useLayoutEffect(() => {
    if (location.key !== landing.current) cancel.current?.()
  }, [location.key])
}
