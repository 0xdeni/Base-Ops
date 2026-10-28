import { describe, expect, it } from 'vitest'
import {
  clearOfEdges,
  fittedTimeTicks,
  linear,
  logPctX,
  median,
  mix2,
  niceStep,
  niceStepUp,
  pathD,
  ticks,
  timeTicks,
} from './scale.js'

describe('linear', () => {
  it('maps a domain onto a range and back', () => {
    const f = linear(0, 100, 300, 0)
    expect(f(0)).toBe(300)
    expect(f(100)).toBe(0)
    expect(f(25)).toBe(225)
    expect(f.invert(225)).toBe(25)
  })

  it('maps a zero-width domain to the start of the range instead of dividing by zero', () => {
    const f = linear(5, 5, 10, 20)
    expect(f(5)).toBe(10)
    expect(Number.isFinite(f.invert(15))).toBe(true)
  })
})

describe('niceStep and ticks (CH1: round values only)', () => {
  it('steps in 1, 2 or 5 × 10ⁿ', () => {
    expect(niceStep(13.8, 3)).toBe(5)
    expect(niceStep(14_335_397, 3)).toBe(5_000_000)
    expect(niceStep(1, 3)).toBe(0.5)
    expect(niceStep(0.3, 3)).toBe(0.1)
    expect(niceStep(80, 3)).toBe(20)
  })

  it('never divides by a zero or invalid span', () => {
    expect(niceStep(0, 3)).toBe(1)
    expect(niceStep(Number.NaN, 3)).toBe(1)
  })

  it('lists the multiples inside the range, with float noise rounded away', () => {
    expect(ticks(0, 13.8, 3)).toEqual([0, 5, 10])
    expect(ticks(0, 14_300_000, 3)).toEqual([0, 5_000_000, 10_000_000])
    expect(ticks(9.2, 11.6, 2)).toEqual([10, 11])
    expect(ticks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3])
  })

  it('returns nothing for an inverted range and the value for a point', () => {
    expect(ticks(5, 1, 3)).toEqual([])
    expect(ticks(2, 2, 3)).toEqual([2])
  })
})

describe('logPctX (CH3: log-spaced ±1, 2, 5 %)', () => {
  const cx = 600
  const half = 596
  it('puts mid at the spine and ±5 % on the edges', () => {
    expect(logPctX(0, cx, half)).toBe(cx)
    expect(logPctX(5, cx, half)).toBeCloseTo(cx + half, 6)
    expect(logPctX(-5, cx, half)).toBeCloseTo(cx - half, 6)
  })

  it('mirrors the sides and spaces the levels by log(1 + |p|)', () => {
    expect(cx - logPctX(-2, cx, half)).toBeCloseTo(logPctX(2, cx, half) - cx, 9)
    const one = logPctX(1, cx, half) - cx
    const two = logPctX(2, cx, half) - cx
    expect(one / half).toBeCloseTo(Math.log(2) / Math.log(6), 9)
    expect(two / one).toBeCloseTo(Math.log(3) / Math.log(2), 9)
  })
})

describe('timeTicks (CH1: landmarks, never 06:56)', () => {
  const day = 86_400
  const start = 1_792_627_200 // 22 Oct 2026, 00:00 UTC (a Thursday)

  it('uses 6-hour landmarks up to 2 days', () => {
    const t = timeTicks([start + 3_300, start + day + 3_300], day)
    expect(t.map((x) => x.label)).toEqual(['06:00', '12:00', '18:00', '00:00'])
    expect(t.every((x) => x.t % 21_600 === 0)).toBe(true)
  })

  it('uses weekday names up to 10 days', () => {
    const t = timeTicks([start - 6 * day, start + 1], 7 * day)
    expect(t.map((x) => x.label)).toEqual(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
  })

  it('uses a weekly date beyond 10 days', () => {
    const t = timeTicks([start - 30 * day, start], 30 * day)
    expect(t[0]?.label).toBe('22\u00a0Sep')
    expect(t.length).toBe(5)
    expect(t[1]?.t).toBe((t[0]?.t ?? 0) + 7 * day)
  })

  it('keeps ticks 14 px clear of the edges', () => {
    const list = [
      { t: 0, label: 'a' },
      { t: 50, label: 'b' },
      { t: 100, label: 'c' },
    ]
    expect(clearOfEdges(list, (t) => t, 0, 100).map((x) => x.label)).toEqual(['b'])
  })
})

describe('helpers', () => {
  it('prints a path with 2-decimal coordinates', () => {
    expect(
      pathD([
        [0, 1],
        [2.345, 3.5],
      ]),
    ).toBe('M0.00 1.00L2.35 3.50')
  })

  it('takes the median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('interpolates two ranges', () => {
    expect(mix2([0, 10], [10, 30], 0.5)).toEqual([5, 20])
  })
})

describe('v4 chart helpers', () => {
  it('takes the smallest round step at or above span / count (1, 2, 2.5, 5, 10 × 10ⁿ)', () => {
    expect(niceStepUp(1_280_000, 5)).toBe(500_000)
    expect(niceStepUp(1_180_000, 5)).toBe(250_000)
    expect(niceStepUp(15_200_000, 5)).toBe(5_000_000)
    expect(niceStepUp(13.83, 3)).toBe(5)
    expect(niceStepUp(60, 3)).toBe(20)
    expect(niceStepUp(0, 3)).toBe(1)
  })

  it('ticks a fitted axis every 15 minutes up to 2 hours, then by landmarks', () => {
    const t0 = Date.UTC(2026, 9, 25, 10, 39) / 1000
    expect(fittedTimeTicks([t0, t0 + 51 * 60]).map((t) => t.label)).toEqual([
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ])
    const day = Date.UTC(2026, 9, 25) / 1000
    expect(fittedTimeTicks([day, day + 86_400]).map((t) => t.label)).toEqual([
      '00:00',
      '06:00',
      '12:00',
      '18:00',
      '00:00',
    ])
    expect(fittedTimeTicks([t0, t0])).toEqual([])
  })
})
