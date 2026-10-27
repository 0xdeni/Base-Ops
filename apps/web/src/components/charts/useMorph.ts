/**
 * The range morph (docs/design/visual-v3.md §4 rows 9–11): when a chart's target state changes
 * (x domain, y domains, the symmetric max, context opacity), it interpolates from whatever is drawn
 * now, mid-morph included, over 280 ms `--ease-in-out` on the tween clock, so rapid toggles never
 * jump. Keyboard changes are instant (M2); reduced motion is instant plus a 150 ms opacity settle
 * (M9). Between morphs the chart draws its target directly, so refetched data never animates (M8).
 */
import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  cancelTween,
  DUR,
  easeInOut,
  prefersReducedMotion,
  settle,
  tween,
} from '../../lib/motion.js'

export interface MorphFrame<S> {
  /** The interpolated state to draw. */
  state: S
  /** The target before this morph, and this morph's target. */
  from: S
  to: S
  /** Eased progress, 0 → 1. */
  e: number
}

export function useMorph<S>(
  target: S,
  opts: {
    /** True when two targets need no morph (compare the parameters, not the data). */
    same: (a: S, b: S) => boolean
    mix: (a: S, b: S, e: number) => S
    /** The latest change came from the keyboard: no motion. */
    instant?: boolean
    /** Faded in after an instant change under reduced motion. */
    settleRef?: RefObject<Element | null>
  },
): { state: S; frame: MorphFrame<S> | null; morphing: boolean } {
  const key = `morph-${useId()}`
  const last = useRef(target)
  const shown = useRef(target)
  const [frame, setFrame] = useState<MorphFrame<S> | null>(null)

  useLayoutEffect(() => {
    if (opts.same(last.current, target)) {
      if (!frame) shown.current = target
      return
    }
    const from = shown.current
    const prev = last.current
    last.current = target
    if (opts.instant || prefersReducedMotion()) {
      cancelTween(key)
      shown.current = target
      setFrame(null)
      if (!opts.instant) settle(opts.settleRef?.current)
      return
    }
    tween(
      key,
      DUR.morph,
      easeInOut,
      (e) => {
        const state = opts.mix(from, target, e)
        shown.current = state
        setFrame({ state, from: prev, to: target, e })
      },
      () => {
        shown.current = target
        setFrame(null)
      },
    )
  })

  useEffect(() => () => cancelTween(key), [key])

  return { state: frame ? frame.state : target, frame, morphing: frame !== null }
}
