/**
 * The Liquidity Health Score worked examples of docs/METRICS.md, reproduced to the digit (the
 * other metrics' examples are in workedExamples.test.ts). A change that moves any figure here must
 * update the page in the same commit.
 */

import { describe, expect, it } from 'vitest'
import type { HealthInputs } from '../types.js'
import {
  computeHealthScore,
  NOTE_CONCENTRATION_NEUTRAL,
  NOTE_CONCENTRATION_RESERVES,
  NOTE_DEPTH_UNKNOWN,
  NOTE_PERSISTENCE_NEUTRAL,
  NOTE_PERSISTENCE_SHORT,
  NOTE_SPREAD_INFEASIBLE,
} from './health.js'
import { computePersistence } from './persistence.js'

const now = 1_700_000_000
const hour = 3600
/** The six samples of the persistence worked example (4 h apart, a 20 h span). */
const sixSamples = [100_000, 120_000, 95_000, 110_000, 40_000, 105_000].map((depthUsd, i) => ({
  timestamp: now - i * 4 * hour,
  depthUsd,
}))
const persistence24h = computePersistence(sixSamples, 24, now)
const twoSamplePersistence = computePersistence(sixSamples.slice(0, 2), 24, now)

describe('docs/METRICS.md worked examples: Liquidity Health Score', () => {
  it('Liquidity Health Score: component examples', () => {
    const base: HealthInputs = {
      depth2UpUsd: 1_200_000,
      depth2DownUsd: 1_200_000,
      spread10kBps: 30,
      ownerTop1Share: 0.42,
      ownerCoverage: 0.95,
      rangeHhi: null,
      poolKind: 'concentrated',
      persistence: persistence24h,
    }
    const components = (inputs: Partial<HealthInputs>) =>
      computeHealthScore({ ...base, ...inputs }).components
    const sides = (up: number, down: number) => ({ depth2UpUsd: up, depth2DownUsd: down })
    expect(components(sides(1_200_000, 1_200_000)).depth).toBe(35)
    expect(components(sides(25_000, 25_000)).depth).toBe(19.82)
    expect(components(sides(1_000, 1_000)).depth).toBe(3.51)
    expect(components(sides(1_000_000, 0)).depth).toBe(0)
    expect(components(sides(5_000, 20_000)).depth).toBe(11.67)
    expect(components({ spread10kBps: 30 }).spread).toBe(16.92)
    expect(components({ spread10kBps: 100 }).spread).toBe(8.08)
    expect(components({ ownerTop1Share: 0.42 }).concentration).toBe(11.6)
    expect(components({ ownerCoverage: 0.4, rangeHhi: 0.18 }).concentration).toBe(16.4)
    expect(components({ ownerTop1Share: null, rangeHhi: 0.18 }).concentration).toBe(16.4)
    expect(
      components({
        ownerTop1Share: null,
        ownerCoverage: null,
        rangeHhi: 1,
        poolKind: 'constant-product',
      }).concentration,
    ).toBe(10)
    expect(components({ persistence: persistence24h }).persistence).toBe(14.92)
  })

  it('Liquidity Health Score: worked examples 1–9', () => {
    const base: HealthInputs = {
      depth2UpUsd: 1_200_000,
      depth2DownUsd: 1_200_000,
      spread10kBps: 30,
      ownerTop1Share: 0.42,
      ownerCoverage: 0.95,
      rangeHhi: null,
      poolKind: 'concentrated',
      persistence: persistence24h,
    }
    // 1. $1.2M on each side, 30 bps, top1Share 0.42, persistence known → 78.44, rated, grade B.
    expect(computeHealthScore(base)).toEqual({
      total: 78.44,
      grade: 'B',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'owners',
      components: { depth: 35, spread: 16.92, concentration: 11.6, persistence: 14.92 },
      notes: [],
    })

    // 2. $25,000 on each side, 100 bps, owners unknown with rangeHhi 0.18, two snapshots → 54.3, C.
    expect(
      computeHealthScore({
        depth2UpUsd: 25_000,
        depth2DownUsd: 25_000,
        spread10kBps: 100,
        ownerTop1Share: null,
        ownerCoverage: null,
        rangeHhi: 0.18,
        poolKind: 'concentrated',
        persistence: twoSamplePersistence,
      }),
    ).toEqual({
      total: 54.3,
      grade: 'C',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'ranges',
      components: { depth: 19.82, spread: 8.08, concentration: 16.4, persistence: 10 },
      notes: [NOTE_PERSISTENCE_NEUTRAL],
    })

    // 3. A pool just discovered, nothing known → 20, unrated (unpriced), no grade, all four notes.
    expect(
      computeHealthScore({
        depth2UpUsd: null,
        depth2DownUsd: null,
        spread10kBps: null,
        ownerTop1Share: null,
        ownerCoverage: null,
        rangeHhi: null,
        poolKind: 'concentrated',
        persistence: null,
      }),
    ).toEqual({
      total: 20,
      grade: null,
      rated: false,
      unratedReason: 'unpriced',
      concentrationBasis: 'neutral',
      components: { depth: 0, spread: 0, concentration: 10, persistence: 10 },
      notes: [
        NOTE_DEPTH_UNKNOWN,
        NOTE_SPREAD_INFEASIBLE,
        NOTE_CONCENTRATION_NEUTRAL,
        NOTE_PERSISTENCE_NEUTRAL,
      ],
    })

    // 4. $500 on each side, 10 bps, a single owner, persistence known → 39.92, unrated (thin).
    expect(
      computeHealthScore({
        ...base,
        depth2UpUsd: 500,
        depth2DownUsd: 500,
        spread10kBps: 10,
        ownerTop1Share: 1,
      }),
    ).toEqual({
      total: 39.92,
      grade: null,
      rated: false,
      unratedReason: 'thin',
      concentrationBasis: 'owners',
      components: { depth: 0, spread: 25, concentration: 0, persistence: 14.92 },
      notes: [],
    })

    // 5. $1,000,000 up and $0 down, otherwise as example 1 → 43.44, unrated (one-sided).
    expect(computeHealthScore({ ...base, depth2UpUsd: 1_000_000, depth2DownUsd: 0 })).toEqual({
      total: 43.44,
      grade: null,
      rated: false,
      unratedReason: 'one-sided',
      concentrationBasis: 'owners',
      components: { depth: 0, spread: 16.92, concentration: 11.6, persistence: 14.92 },
      notes: [],
    })

    // 6. $5,000 up and $20,000 down → 55.11, rated, grade C; $4,999.99 up → unrated (one-sided).
    expect(computeHealthScore({ ...base, depth2UpUsd: 5_000, depth2DownUsd: 20_000 })).toEqual({
      total: 55.11,
      grade: 'C',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'owners',
      components: { depth: 11.67, spread: 16.92, concentration: 11.6, persistence: 14.92 },
      notes: [],
    })
    const justBelow = computeHealthScore({ ...base, depth2UpUsd: 4_999.99, depth2DownUsd: 20_000 })
    expect(justBelow.rated).toBe(false)
    expect(justBelow.unratedReason).toBe('one-sided')

    // 7. Three snapshots a minute apart: all 0 → persistence 0; all 100,000 → unknown → 10.
    const minute = (depthUsd: number) =>
      computePersistence(
        [0, 1, 2].map((i) => ({ timestamp: now - i * 60, depthUsd })),
        24,
        now,
      )
    expect(computeHealthScore({ ...base, persistence: minute(0) }).components.persistence).toBe(0)
    const unknown = computeHealthScore({ ...base, persistence: minute(100_000) })
    expect(unknown.components.persistence).toBe(10)
    expect(unknown.notes).toEqual([NOTE_PERSISTENCE_SHORT])
    // 8. As example 1, but the owners cover 40 % and rangeHhi = 0.18 → 83.24, A, from the ranges.
    expect(computeHealthScore({ ...base, ownerCoverage: 0.4, rangeHhi: 0.18 })).toEqual({
      total: 83.24,
      grade: 'A',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'ranges',
      components: { depth: 35, spread: 16.92, concentration: 16.4, persistence: 14.92 },
      notes: ['owner data covers 40 % of in-band liquidity'],
    })

    // 9. An Aerodrome v2 pool, $25,000 a side, 100 bps → 52.82, C; from rangeHhi = 1 it was 42.82.
    const v2: HealthInputs = {
      ...base,
      depth2UpUsd: 25_000,
      depth2DownUsd: 25_000,
      spread10kBps: 100,
      ownerTop1Share: null,
      ownerCoverage: null,
      rangeHhi: 1,
      poolKind: 'constant-product',
    }
    expect(computeHealthScore(v2)).toEqual({
      total: 52.82,
      grade: 'C',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'neutral',
      components: { depth: 19.82, spread: 8.08, concentration: 10, persistence: 14.92 },
      notes: [NOTE_CONCENTRATION_RESERVES],
    })
    expect(computeHealthScore({ ...v2, poolKind: 'concentrated' }).total).toBe(42.82)
  })
})
