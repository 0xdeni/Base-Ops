/**
 * The first view (docs/design/visual-v4.md §4.1): the session gate, the steps of the timeline and
 * their 450 ms ceiling, one start instant, and the opacity-only reduced-motion version.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_VIEW_KEY,
  FIRST_VIEW_MS,
  firstViewDue,
  firstViewSteps,
  isSettled,
  markFirstView,
  playFirstView,
} from './firstView.js'

/** A landing page with every kind of element the timeline animates. */
function page(): HTMLElement {
  const main = document.createElement('main')
  main.innerHTML = `
    <section class="band">
      <div class="band-ground"></div>
      <p class="eyebrow" data-in>Pools</p>
      <h1 data-rise>pools</h1><p data-rise>492 pools</p><p data-rise>a third part</p>
      <p class="lead" data-in>Lead</p><div data-in>Actions</div>
      <figure data-chart>
        ${'<i data-bar></i>'.repeat(14)}<i data-bar="y"></i>
        <p data-furniture>$20.7M</p>
        <div class="field">${[0, 1, 2, 3, 4].map((i) => `<i data-sq style="transform: translate(${i * 10}px, 4px)"></i>`).join('')}</div>
        <svg><g data-area></g><rect data-pt></rect><rect data-pt></rect></svg>
      </figure>
    </section>
    <section class="overlap">
      <div data-over>${'<i data-bar></i>'.repeat(3)}</div>
      <div data-over></div><div data-over></div><div data-over></div>
    </section>
    <section class="previews"><i data-bar class="off-band"></i></section>`
  return main
}

const props = (k: Keyframe) => Object.keys(k).filter((p) => p !== 'offset' && p !== 'easing')

beforeEach(() => window.sessionStorage.clear())

describe('the session gate', () => {
  it('is due once per session, and again with ?replay=1', () => {
    expect(firstViewDue('')).toBe(true)
    markFirstView()
    expect(window.sessionStorage.getItem(FIRST_VIEW_KEY)).toBe('1')
    expect(firstViewDue('')).toBe(false)
    expect(firstViewDue('', '?replay=1')).toBe(true)
    expect(firstViewDue('?replay=1')).toBe(true)
  })

  it('plays again where storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => markFirstView()).not.toThrow()
    expect(firstViewDue('')).toBe(true)
    get.mockRestore()
    set.mockRestore()
  })

  it('waits for the landing route to render its content', () => {
    const main = document.createElement('main')
    expect(isSettled(main)).toBe(false)
    main.innerHTML = '<h1>pools</h1><div class="skel-stack" role="status"></div>'
    expect(isSettled(main)).toBe(false)
    main.innerHTML = '<h1>pools</h1><div aria-busy="true"></div>'
    expect(isSettled(main)).toBe(false)
    main.innerHTML = '<h1>pools</h1>'
    expect(isSettled(main)).toBe(true)
  })
})

describe('the timeline', () => {
  it('ends every step by 450 ms and animates only opacity, transform and clip-path', () => {
    const steps = firstViewSteps(page(), false)
    expect(steps.length).toBeGreaterThan(30)
    for (const s of steps) {
      expect(s.delay + s.duration).toBeLessThanOrEqual(FIRST_VIEW_MS)
      for (const k of s.keyframes)
        for (const p of props(k)) expect(['opacity', 'transform', 'clipPath']).toContain(p)
    }
    expect(Math.max(...steps.map((s) => s.delay + s.duration))).toBe(440)
  })

  it('drops the band ground first, then the title parts, 40 ms apart', () => {
    const main = page()
    const steps = firstViewSteps(main, false)
    const of = (el: Element | null) => steps.filter((s) => s.el === el)
    const [ground] = of(main.querySelector('.band-ground'))
    expect(ground?.keyframes[0]).toEqual({ clipPath: 'inset(0 0 40% 0)' })
    expect([ground?.delay, ground?.duration]).toEqual([0, 380])
    const rise = [...main.querySelectorAll('[data-rise]')].map((el) => of(el)[0]?.delay)
    expect(rise).toEqual([0, 40, 80])
    const ins = [...main.querySelectorAll('[data-in]')].map((el) => of(el)[0]?.delay)
    expect(ins).toEqual([60, 90, 120])
  })

  it('grows bars from their spine with the band, those in a block with that block, no others', () => {
    const main = page()
    const steps = firstViewSteps(main, false)
    const bars = steps.filter((s) => s.el.hasAttribute('data-bar'))
    const onBand = bars.filter((s) => !s.el.closest('[data-over]'))
    expect(onBand.map((s) => s.delay)).toEqual([
      80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 180, 180, 180, 180,
    ])
    expect(onBand.at(-1)?.keyframes).toEqual([
      { transform: 'scaleY(0.001)' },
      { transform: 'scaleY(1)' },
    ])
    const inBlock = bars.filter((s) => s.el.closest('[data-over]'))
    expect(inBlock.map((s) => [s.delay, s.duration])).toEqual([
      [100, 240],
      [110, 240],
      [120, 240],
    ])
    const blocks = steps.filter((s) => s.el.hasAttribute('data-over')).map((s) => s.delay)
    expect(blocks).toEqual([80, 100, 120, 120])
    expect(steps.filter((s) => s.el.classList.contains('off-band'))).toEqual([])
  })

  it('shows furniture after its marks and the field largest first, keeping each square in place', () => {
    const main = page()
    const steps = firstViewSteps(main, false)
    const furniture = steps.find((s) => s.el.hasAttribute('data-furniture'))
    expect([furniture?.delay, furniture?.easing]).toEqual([260, 'linear'])
    const squares = steps.filter((s) => s.el.hasAttribute('data-sq'))
    expect(squares.map((s) => s.delay)).toEqual([40, 140, 181, 213, 240])
    expect(squares[1]?.keyframes[0]).toEqual({
      opacity: 0,
      transform: 'translate(10px, 4px) scale(0.6)',
    })
    const area = steps.find((s) => s.el.hasAttribute('data-area'))
    expect(area?.keyframes[0]).toEqual({ clipPath: 'inset(0 50% 0 50%)' })
    const points = steps.filter((s) => s.el.hasAttribute('data-pt')).map((s) => s.delay)
    expect(points).toEqual([220, 220])
  })

  it('fades the main parts under reduced motion and moves nothing', () => {
    const steps = firstViewSteps(page(), true)
    expect(steps.length).toBe(1 + 3 + 3 + 1 + 4)
    for (const s of steps) {
      expect([s.delay, s.duration, s.easing]).toEqual([0, 200, 'linear'])
      expect(s.keyframes.flatMap(props)).toEqual(['opacity', 'opacity'])
    }
  })
})

describe('playing it', () => {
  type Rec = { keyframes: Keyframe[]; options: KeyframeEffectOptions; startTime: number | null }
  let recs: Rec[]
  beforeEach(() => {
    recs = []
    Element.prototype.animate = function animate(keyframes, options) {
      const rec: Rec = {
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeEffectOptions,
        startTime: null,
      }
      recs.push(rec)
      return rec as unknown as Animation
    }
    Object.defineProperty(document, 'timeline', {
      configurable: true,
      value: { currentTime: 1234 },
    })
  })
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
    Reflect.deleteProperty(document, 'timeline')
  })

  it('starts every animation from one instant, held at its first frame during its delay', () => {
    const anims = playFirstView(page(), { reduced: false })
    expect(anims).toHaveLength(recs.length)
    expect(new Set(recs.map((r) => r.startTime))).toEqual(new Set([1234]))
    for (const r of recs) {
      expect(r.options.fill).toBe('backwards')
      expect(r.options.iterations ?? 1).toBe(1)
    }
  })
})
