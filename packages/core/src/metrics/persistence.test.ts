import { describe, expect, it } from 'vitest'
import { computePersistence, PERSISTENCE_MIN_COVERAGE } from './persistence.js'

const now = 1_700_000_000
const hour = 3600

/** Samples `spacing` seconds apart, newest at `now`, with the given depths (newest first). */
const spaced = (depths: number[], spacing: number) =>
  depths.map((depthUsd, i) => ({ timestamp: now - i * spacing, depthUsd }))

describe('computePersistence', () => {
  it('computes median, p10, min, stability and uptime over the window', () => {
    const m = computePersistence(spaced([100, 80, 120, 10, 90], 4 * hour), 24, now)
    expect(m.windowHours).toBe(24)
    expect(m.samples).toBe(5)
    expect(m.depthUsdMedian).toBe(90)
    expect(m.depthUsdP10).toBeCloseTo(38, 12) // sorted 10,80,90,100,120 → rank 0.4 → 10 + 0.4·70
    expect(m.depthUsdMin).toBe(10)
    expect(m.stability).toBeCloseTo(38 / 90, 12)
    expect(m.uptime).toBe(0.8) // 10 < 45
  })

  it('is null with fewer than 3 samples but still reports the statistics', () => {
    const two = computePersistence(
      [
        { timestamp: now, depthUsd: 50 },
        { timestamp: now - 12 * hour, depthUsd: 100 },
      ],
      24,
      now,
    )
    expect(two.samples).toBe(2)
    expect(two.stability).toBeNull()
    expect(two.uptime).toBeNull()
    expect(two.depthUsdMedian).toBe(75)
    expect(two.depthUsdMin).toBe(50)
    const none = computePersistence([], 24, now)
    expect(none).toEqual({
      windowHours: 24,
      samples: 0,
      depthUsdMedian: null,
      depthUsdP10: null,
      depthUsdMin: null,
      stability: null,
      uptime: null,
    })
  })

  it('needs the samples to cover a quarter of the window', () => {
    expect(PERSISTENCE_MIN_COVERAGE).toBe(0.25)
    const depths = [100, 100, 100]
    // 24 h window: 6 h is the minimum span
    const justShort = computePersistence(spaced(depths, 2.95 * hour), 24, now) // 5.9 h
    expect(justShort.samples).toBe(3)
    expect(justShort.stability).toBeNull()
    expect(justShort.uptime).toBeNull()
    expect(justShort.depthUsdMedian).toBe(100) // statistics still reported
    const exactly = computePersistence(spaced(depths, 3 * hour), 24, now) // 6 h
    expect(exactly.stability).toBe(1)
    expect(exactly.uptime).toBe(1)
    const wide = computePersistence(spaced(depths, 11.5 * hour), 24, now) // 23 h
    expect(wide.stability).toBe(1)
    expect(wide.uptime).toBe(1)
  })

  it('applies 42 h to the 7 d window: 25 h is known for 24 h but not for 7 d', () => {
    const week = 24 * 7
    // 41 h and 25 h spans, in a 7 d window: too short; 43 h: enough
    for (const spanHours of [25, 41]) {
      const m = computePersistence(spaced([100, 90, 110], (spanHours / 2) * hour), week, now)
      expect(m.samples).toBe(3)
      expect(m.stability).toBeNull()
      expect(m.uptime).toBeNull()
    }
    const long = computePersistence(spaced([100, 90, 110], 21.5 * hour), week, now) // 43 h
    expect(long.stability).not.toBeNull()
    expect(long.uptime).toBe(1)
    const exactly = computePersistence(spaced([100, 90, 110], 21 * hour), week, now) // 42 h
    expect(exactly.stability).not.toBeNull()
    // the same 23 h of samples is known for the 24 h window
    const day = computePersistence(spaced([100, 90, 110], 11.5 * hour), 24, now)
    expect(day.stability).not.toBeNull()
  })

  it('five snapshots in about an hour (the first live run) are unknown', () => {
    const live = [0, 332, 668, 2730, 3082].map((t, i) => ({
      timestamp: now - 3082 + t,
      depthUsd: 1_000 + i,
    }))
    const m = computePersistence(live, 24, now)
    expect(m.samples).toBe(5)
    expect(m.stability).toBeNull()
    expect(m.uptime).toBeNull()
  })

  it('filters by window and drops null depths', () => {
    const samples = [
      { timestamp: now, depthUsd: 100 },
      { timestamp: now - 2 * hour, depthUsd: null },
      { timestamp: now - 23 * hour, depthUsd: 100 },
      { timestamp: now - 25 * hour, depthUsd: 1 }, // outside 24h
      { timestamp: now + hour, depthUsd: 1 }, // the future is ignored
      { timestamp: now - 12 * hour, depthUsd: 100 },
    ]
    const m = computePersistence(samples, 24, now)
    expect(m.samples).toBe(3)
    expect(m.stability).toBe(1)
    expect(m.uptime).toBe(1)
    const week = computePersistence(samples, 24 * 7, now)
    expect(week.samples).toBe(4)
    expect(week.depthUsdMin).toBe(1)
  })

  it('a zero median is a dead pool: stability and uptime are 0, not 1', () => {
    const flat = computePersistence(
      [0, 0, 0].map((d, i) => ({ timestamp: now - i, depthUsd: d })),
      1,
      now,
    )
    expect(flat.stability).toBe(0)
    expect(flat.uptime).toBe(0)
    // whatever the coverage: three zero samples a second apart in a 24 h window
    const dead = computePersistence(spaced([0, 0, 0], 1), 24, now)
    expect(dead.stability).toBe(0)
    expect(dead.uptime).toBe(0)
    // but fewer than 3 samples are still unknown
    const two = computePersistence(spaced([0, 0], 5 * hour), 24, now)
    expect(two.stability).toBeNull()
    expect(two.uptime).toBeNull()
    // and a mostly-zero series (median 0) with one deep sample is dead too
    const mostly = computePersistence(spaced([0, 0, 0, 500], 5 * hour), 24, now)
    expect(mostly.depthUsdMedian).toBe(0)
    expect(mostly.uptime).toBe(0)
  })

  it('takes series longer than a spread call can (200 000 samples)', () => {
    const many = Array.from({ length: 200_000 }, (_, i) => ({
      timestamp: now - (i % 3_000),
      depthUsd: 1_000 + (i % 97),
    }))
    const m = computePersistence(many, 1, now)
    expect(m.samples).toBe(200_000)
    expect(m.depthUsdMin).toBe(1_000)
    expect(m.uptime).toBe(1)
  })
})
