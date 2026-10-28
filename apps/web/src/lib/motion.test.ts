import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bezier,
  easeInOut,
  easeOut,
  isKeyboardClick,
  isTweening,
  prefersReducedMotion,
  tween,
} from './motion.js'

describe('easings (§3.8)', () => {
  it('runs from 0 to 1 and clamps outside the range', () => {
    for (const ease of [easeInOut, easeOut, bezier(0.32, 0.72, 0, 1)]) {
      expect(ease(0)).toBe(0)
      expect(ease(1)).toBe(1)
      expect(ease(-1)).toBe(0)
      expect(ease(2)).toBe(1)
      let prev = 0
      for (let t = 0.05; t < 1; t += 0.05) {
        const v = ease(t)
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })

  it('matches the CSS curves: ease-out is front-loaded, ease-in-out is slow at both ends', () => {
    expect(easeOut(0.2)).toBeGreaterThan(0.6)
    expect(easeInOut(0.1)).toBeLessThan(0.05)
    expect(easeInOut(0.9)).toBeGreaterThan(0.95)
    expect(bezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 4)
  })
})

describe('the tween clock', () => {
  it('applies the end state at once for ms <= 0 (keyboard, reduced motion)', () => {
    const step = vi.fn()
    const done = vi.fn()
    tween('k0', 0, easeInOut, step, done)
    expect(step).toHaveBeenCalledExactlyOnceWith(1)
    expect(done).toHaveBeenCalledOnce()
    expect(isTweening('k0')).toBe(false)
  })

  it('applies the end state at once where the Web Animations API is missing', () => {
    const step = vi.fn()
    tween('k1', 280, easeInOut, step)
    expect(step).toHaveBeenCalledExactlyOnceWith(1)
  })

  describe('with a seekable clock', () => {
    type Fake = { currentTime: number; playState: string; cancel: ReturnType<typeof vi.fn> }
    let anims: Fake[]
    let frames: FrameRequestCallback[]
    beforeEach(() => {
      anims = []
      frames = []
      HTMLElement.prototype.animate = function animate() {
        const a: Fake = { currentTime: 0, playState: 'running', cancel: vi.fn() }
        anims.push(a)
        return a as unknown as Animation
      }
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
      vi.stubGlobal('cancelAnimationFrame', () => {})
    })
    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate')
      vi.unstubAllGlobals()
    })
    const tick = () => {
      const run = frames
      frames = []
      for (const cb of run) cb(0)
    }

    it('follows the clock animation and finishes on its last frame', () => {
      const values: number[] = []
      const done = vi.fn()
      const linear = (t: number) => t
      tween('k2', 200, linear, (e) => values.push(e), done)
      expect(values).toEqual([0])
      expect(isTweening('k2')).toBe(true)
      const clock = anims[0]
      if (!clock) throw new Error('no clock animation')
      clock.currentTime = 100
      tick()
      expect(values.at(-1)).toBe(0.5)
      clock.playState = 'finished'
      tick()
      expect(values.at(-1)).toBe(1)
      expect(done).toHaveBeenCalledOnce()
      expect(isTweening('k2')).toBe(false)
    })

    it('cancels the previous tween on the same key, so the next starts where it stopped', () => {
      const first = vi.fn()
      const done = vi.fn()
      tween('k3', 280, easeInOut, () => {}, first)
      tween('k3', 280, easeInOut, () => {}, done)
      expect(anims[0]?.cancel).toHaveBeenCalledOnce()
      expect(first).not.toHaveBeenCalled()
      expect(isTweening('k3')).toBe(true)
    })
  })
})

describe('shared rules (M2, M9)', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('treats detail === 0 clicks as keyboard-initiated', () => {
    expect(isKeyboardClick({ detail: 0 })).toBe(true)
    expect(isKeyboardClick({ detail: 1 })).toBe(false)
  })

  it('reads the reduced-motion preference, and none where matchMedia is missing', () => {
    expect(prefersReducedMotion()).toBe(false)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }),
    })
    expect(prefersReducedMotion()).toBe(true)
  })
})
