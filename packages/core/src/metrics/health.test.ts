import { describe, expect, it } from 'vitest'
import type { HealthInputs, PersistenceMetrics } from '../types.js'
import {
  computeHealthScore,
  HEALTH_RATING_MIN_SIDE_USD,
  healthGrade,
  isHookedPool,
  NOTE_CONCENTRATION_NEUTRAL,
  NOTE_DEPTH_UNKNOWN,
  NOTE_PERSISTENCE_NEUTRAL,
  NOTE_PERSISTENCE_SHORT,
  NOTE_SPREAD_INFEASIBLE,
  rateDepth,
  thinnerSideUsd,
} from './health.js'

const persistence = (
  stability: number | null,
  uptime: number | null,
  samples = 10,
): PersistenceMetrics => ({
  windowHours: 24,
  samples,
  depthUsdMedian: 1,
  depthUsdP10: 1,
  depthUsdMin: 1,
  stability,
  uptime,
})

/** Both sides at the same depth. */
const balanced = (usd: number | null) => ({ depth2UpUsd: usd, depth2DownUsd: usd })

const perfect: HealthInputs = {
  ...balanced(500_000),
  spread10kBps: 10,
  ownerTop1Share: 0.001,
  rangeHhi: 0.1,
  persistence: persistence(1, 1),
}

describe('rateDepth', () => {
  it('is rated exactly at the floor on the thinner side', () => {
    expect(HEALTH_RATING_MIN_SIDE_USD).toBe(5_000)
    expect(rateDepth(5_000, 5_000)).toEqual({ rated: true, unratedReason: null })
    expect(rateDepth(5_000, 20_000)).toEqual({ rated: true, unratedReason: null })
    expect(rateDepth(20_000, 5_000)).toEqual({ rated: true, unratedReason: null })
    expect(rateDepth(1e9, 5_000.01).rated).toBe(true)
  })

  it('is one-sided when the deeper side holds the floor and the thinner does not', () => {
    expect(rateDepth(4_999.99, 20_000)).toEqual({ rated: false, unratedReason: 'one-sided' })
    expect(rateDepth(1_000_000, 0)).toEqual({ rated: false, unratedReason: 'one-sided' })
    expect(rateDepth(0, 5_000)).toEqual({ rated: false, unratedReason: 'one-sided' })
    expect(rateDepth(1.2e-6, 1_000_000)).toEqual({ rated: false, unratedReason: 'one-sided' })
  })

  it('is thin when neither side holds the floor', () => {
    expect(rateDepth(4_999.99, 4_999.99)).toEqual({ rated: false, unratedReason: 'thin' })
    expect(rateDepth(0, 0)).toEqual({ rated: false, unratedReason: 'thin' })
    expect(rateDepth(4_000, 0)).toEqual({ rated: false, unratedReason: 'thin' })
  })

  it('is unpriced when a side is unknown, whatever the other side holds', () => {
    for (const [up, down] of [
      [null, null],
      [null, 1_000_000],
      [1_000_000, null],
      [Number.NaN, 1_000_000],
      [1_000_000, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(rateDepth(up, down)).toEqual({ rated: false, unratedReason: 'unpriced' })
    }
  })

  it('is hooked for a Uniswap v4 pool with a hook, before any side is looked at', () => {
    expect(rateDepth(1_000_000, 1_000_000, { hooked: true })).toEqual({
      rated: false,
      unratedReason: 'hooked',
    })
    expect(rateDepth(null, null, { hooked: true }).unratedReason).toBe('hooked')
    expect(rateDepth(1_000_000, 1_000_000, { hooked: false }).rated).toBe(true)
  })

  it('isHookedPool: a non-zero hooks address only', () => {
    expect(isHookedPool({ hooks: null })).toBe(false)
    expect(isHookedPool({ hooks: '0x0000000000000000000000000000000000000000' })).toBe(false)
    expect(isHookedPool({ hooks: '0x00000000000000000000000000000000000000c0' })).toBe(true)
  })

  it('a hooked pool is unrated with reason hooked; its total is kept', () => {
    const score = computeHealthScore({ ...perfect, hooked: true })
    expect(score).toMatchObject({ rated: false, grade: null, unratedReason: 'hooked' })
    expect(score.total).toBe(computeHealthScore(perfect).total)
  })

  it('thinnerSideUsd is the smaller side, null when either is unknown', () => {
    expect(thinnerSideUsd(3, 9)).toBe(3)
    expect(thinnerSideUsd(9, 3)).toBe(3)
    expect(thinnerSideUsd(null, 3)).toBeNull()
    expect(thinnerSideUsd(3, null)).toBeNull()
  })
})

describe('computeHealthScore', () => {
  it('depth component uses twice the thinner side', () => {
    const depth = (up: number | null, down: number | null) =>
      computeHealthScore({ ...perfect, depth2UpUsd: up, depth2DownUsd: down }).components.depth
    expect(depth(500, 500)).toBe(0) // 2 × 500 = $1k → 0
    expect(depth(1_000, 1_000)).toBe(3.51) // 2 × 1,000 = $2k
    expect(depth(500_000, 500_000)).toBe(35)
    expect(depth(1e9, 1e9)).toBe(35)
    expect(depth(15_811.3883, 15_811.3883)).toBeCloseTo(17.5, 1) // 2 × 15,811 = 31,623
    expect(depth(25_000, 25_000)).toBe(19.82)
    expect(depth(5_000, 20_000)).toBe(11.67)
    expect(depth(20_000, 5_000)).toBe(11.67)
    expect(depth(0, 0)).toBe(0)
  })

  it('a one-sided pool cannot buy depth points with its deep side', () => {
    const oneSided = computeHealthScore({ ...perfect, depth2UpUsd: 1_000_000, depth2DownUsd: 0 })
    expect(oneSided.components.depth).toBe(0)
    expect(oneSided.rated).toBe(false)
    expect(oneSided.unratedReason).toBe('one-sided')
    expect(oneSided.grade).toBeNull()
    // the summed depth would have been $1M: the full 35
    const summed = computeHealthScore({ ...perfect, depth2UpUsd: 500_000, depth2DownUsd: 500_000 })
    expect(summed.components.depth).toBe(35)
  })

  it('an unknown side scores depth 0 with a note', () => {
    for (const [up, down] of [
      [null, null],
      [1_000_000, null],
      [null, 1_000_000],
    ] as const) {
      const s = computeHealthScore({ ...perfect, depth2UpUsd: up, depth2DownUsd: down })
      expect(s.components.depth).toBe(0)
      expect(s.notes).toContain(NOTE_DEPTH_UNKNOWN)
      expect(s.unratedReason).toBe('unpriced')
      expect(s.grade).toBeNull()
    }
  })

  it('spread component boundaries', () => {
    expect(computeHealthScore({ ...perfect, spread10kBps: 10 }).components.spread).toBe(25)
    expect(computeHealthScore({ ...perfect, spread10kBps: 1 }).components.spread).toBe(25)
    expect(computeHealthScore({ ...perfect, spread10kBps: 300 }).components.spread).toBe(0)
    expect(computeHealthScore({ ...perfect, spread10kBps: 1000 }).components.spread).toBe(0)
    expect(
      computeHealthScore({ ...perfect, spread10kBps: Math.sqrt(3000) }).components.spread,
    ).toBeCloseTo(12.5, 1)
    const infeasible = computeHealthScore({ ...perfect, spread10kBps: null })
    expect(infeasible.components.spread).toBe(0)
    expect(infeasible.notes).toContain(NOTE_SPREAD_INFEASIBLE)
  })

  it('concentration prefers owners, falls back to range HHI, else neutral', () => {
    expect(
      computeHealthScore({ ...perfect, ownerTop1Share: 0.4, rangeHhi: 0.9 }).components
        .concentration,
    ).toBe(12)
    expect(
      computeHealthScore({ ...perfect, ownerTop1Share: null, rangeHhi: 0.25 }).components
        .concentration,
    ).toBe(15)
    expect(
      computeHealthScore({ ...perfect, ownerTop1Share: 1, rangeHhi: 0 }).components.concentration,
    ).toBe(0)
    // a zero top1 share means no indexed owners: fall through to range data
    expect(
      computeHealthScore({ ...perfect, ownerTop1Share: 0, rangeHhi: 0.5 }).components.concentration,
    ).toBe(10)
    const neutral = computeHealthScore({ ...perfect, ownerTop1Share: null, rangeHhi: null })
    expect(neutral.components.concentration).toBe(10)
    expect(neutral.notes).toContain(NOTE_CONCENTRATION_NEUTRAL)
  })

  it('persistence is neutral when unknown, with the note that names the cause', () => {
    expect(
      computeHealthScore({ ...perfect, persistence: persistence(0.5, 1) }).components.persistence,
    ).toBe(15)
    // fewer than 3 samples, or no persistence at all
    for (const p of [null, persistence(null, null, 2), persistence(null, null, 0)]) {
      const s = computeHealthScore({ ...perfect, persistence: p })
      expect(s.components.persistence).toBe(10)
      expect(s.notes).toContain(NOTE_PERSISTENCE_NEUTRAL)
    }
    // 3 or more samples that do not cover enough of the window
    const short = computeHealthScore({ ...perfect, persistence: persistence(null, null, 5) })
    expect(short.components.persistence).toBe(10)
    expect(short.notes).toContain(NOTE_PERSISTENCE_SHORT)
    expect(short.notes).not.toContain(NOTE_PERSISTENCE_NEUTRAL)
  })

  it('a dead pool earns nothing for persistence', () => {
    const dead = computeHealthScore({ ...perfect, persistence: persistence(0, 0) })
    expect(dead.components.persistence).toBe(0)
  })

  it('totals, grades and unrated pools', () => {
    const best = computeHealthScore(perfect)
    expect(best.total).toBeCloseTo(99.98, 2)
    expect(best.grade).toBe('A')
    expect(best.rated).toBe(true)
    expect(best.unratedReason).toBeNull()
    expect(best.notes).toEqual([])
    const worst = computeHealthScore({
      ...balanced(5_000),
      spread10kBps: 1000,
      ownerTop1Share: 1,
      rangeHhi: 1,
      persistence: persistence(0, 0),
    })
    expect(worst.components).toEqual({ depth: 11.67, spread: 0, concentration: 0, persistence: 0 })
    expect(worst.grade).toBe('F')
    expect(worst.rated).toBe(true)
    // unrated: numeric score kept, grade withheld
    const empty = computeHealthScore({
      ...balanced(10),
      spread10kBps: 1000,
      ownerTop1Share: 1,
      rangeHhi: 1,
      persistence: persistence(0, 0),
    })
    expect(empty.total).toBe(0)
    expect(empty.grade).toBeNull()
    expect(empty.unratedReason).toBe('thin')
    const nothing = computeHealthScore({
      depth2UpUsd: null,
      depth2DownUsd: null,
      spread10kBps: null,
      ownerTop1Share: null,
      rangeHhi: null,
      persistence: null,
    })
    expect(nothing.total).toBe(20)
    expect(nothing.grade).toBeNull()
    expect(nothing.unratedReason).toBe('unpriced')
    expect(nothing.notes).toHaveLength(4)
    expect(healthGrade(80)).toBe('A')
    expect(healthGrade(79.99)).toBe('B')
    expect(healthGrade(65)).toBe('B')
    expect(healthGrade(50)).toBe('C')
    expect(healthGrade(35)).toBe('D')
    expect(healthGrade(34.99)).toBe('F')
  })

  it('grades only at or above the floor: the boundary pool is rated, a cent below is not', () => {
    const at = computeHealthScore({ ...perfect, depth2UpUsd: 5_000, depth2DownUsd: 5_000 })
    expect(at.rated).toBe(true)
    expect(at.grade).toBe('B')
    const below = computeHealthScore({ ...perfect, ...balanced(4_999.99) })
    expect(below.rated).toBe(false)
    expect(below.unratedReason).toBe('thin')
    expect(below.grade).toBeNull()
    expect(below.total).toBeGreaterThan(0)
    const oneSided = computeHealthScore({ ...perfect, depth2UpUsd: 4_999.99, depth2DownUsd: 5_000 })
    expect(oneSided.unratedReason).toBe('one-sided')
  })
})
