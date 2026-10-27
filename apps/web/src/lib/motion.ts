/**
 * Motion primitives (docs/design/visual-v3.md §3.8, §4): the three easings as JS functions, the
 * interruptible tween clock every JS-driven morph goes through, and the rules shared by every
 * animation: keyboard-initiated actions never animate (M2) and reduced motion swaps movement for an
 * instant change plus an opacity settle (M9).
 */
import { useMediaQuery } from './useMediaQuery.js'

export type Ease = (t: number) => number

/** CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress: Newton's method on x(t). */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-5) break
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    return sy(Math.min(1, Math.max(0, t)))
  }
}

/** On-screen movement: thumb, indicator, morphs, lens. */
export const easeInOut = bezier(0.77, 0, 0.175, 1)
/** Enter, exit, press, popovers, intro. */
export const easeOut = bezier(0.23, 1, 0.32, 1)

/** The same curves as CSS strings, for the Web Animations API. */
export const EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

/** Durations in ms (the `--dur-*` tokens, plus the close and settle times of §4). */
export const DUR = {
  press: 160,
  hover: 120,
  tooltip: 140,
  popover: 180,
  exit: 100,
  disclosure: 200,
  disclosureClose: 150,
  dialog: 240,
  route: 180,
  morph: 280,
  sheet: 500,
  sheetOut: 300,
  stagger: 30,
  settle: 150,
  tooltipDelay: 600,
  tooltipWarm: 400,
  copied: 2000,
} as const

let clock: HTMLElement | null = null

/** The hidden element whose no-op Web Animations time every tween; created once, on first use. */
function getClock(): HTMLElement | null {
  if (clock) return clock
  if (typeof document === 'undefined' || !document.body) return null
  const el = document.createElement('i')
  el.className = 'clock'
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  clock = el
  return el
}

interface Running {
  raf: number
  anim: Animation
}
const running = new Map<string, Running>()

/**
 * Runs `step(eased progress)` every frame for `ms`, then `done`. A new tween on the same key
 * cancels the old one; callers keep their interpolated state, so the next tween starts wherever
 * the last one stopped (no jump on rapid toggles). `ms <= 0`, or a browser without the Web
 * Animations API, applies the end state at once. Pausing or seeking the clock animation (tests,
 * devtools) drives the morph.
 */
export function tween(
  key: string,
  ms: number,
  ease: Ease,
  step: (e: number) => void,
  done?: () => void,
): void {
  cancelTween(key)
  const el = ms > 0 ? getClock() : null
  if (!el || typeof el.animate !== 'function') {
    step(1)
    done?.()
    return
  }
  const anim = el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: ms })
  const rec: Running = { raf: 0, anim }
  running.set(key, rec)
  const frame = () => {
    const finished = anim.playState === 'finished'
    step(ease(finished ? 1 : Math.min(1, Number(anim.currentTime ?? 0) / ms)))
    if (finished) {
      running.delete(key)
      done?.()
    } else rec.raf = requestAnimationFrame(frame)
  }
  step(ease(0))
  rec.raf = requestAnimationFrame(frame)
}

/** Whether a tween on `key` is running (scrubbing pauses while a morph runs). */
export const isTweening = (key: string): boolean => running.has(key)

/** Stops a tween where it is, without calling its `done`. */
export function cancelTween(key: string): void {
  const prev = running.get(key)
  if (!prev) return
  cancelAnimationFrame(prev.raf)
  prev.anim.cancel()
  running.delete(key)
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** True when the reader asked for reduced motion (false where `matchMedia` is missing). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** `prefersReducedMotion()` as a hook that re-renders when the preference changes. */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}

/**
 * A click with `detail === 0` came from the keyboard (Enter or Space) or from script: keyboard
 * actions never animate (M2).
 */
export function isKeyboardClick(e: { detail: number }): boolean {
  return e.detail === 0
}

/** The duration to use: 0 for keyboard-initiated actions and under reduced motion. */
export function motionMs(ms: number, opts: { keyboard?: boolean; reduced?: boolean } = {}): number {
  if (opts.keyboard) return 0
  if (opts.reduced ?? prefersReducedMotion()) return 0
  return ms
}

/** `el.animate(…)` where the Web Animations API exists; null elsewhere (jsdom, old engines). */
export function animate(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!el || typeof el.animate !== 'function') return null
  return el.animate(keyframes, options)
}

/**
 * The reduced-motion stand-in for a morph (§3.8): the chart jumps to its end state, then settles
 * from 0.4 to full opacity over 150 ms.
 */
export function settle(el: Element | null | undefined): Animation | null {
  return animate(el, [{ opacity: 0.4 }, { opacity: 1 }], { duration: DUR.settle, easing: 'ease' })
}
