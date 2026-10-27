import { describe, expect, it } from 'vitest'
import {
  computeUptime,
  currentStreak,
  scorecardStatus,
  summarizeScorecard,
  worstExcursions,
} from './scorecard.js'
import type { BreachStreak, Mandate, MmAttribution, MmSample } from './types.js'

const now = 1_700_000_000
const hour = 3600
const day = 24 * hour

const mandate: Mandate = {
  id: 'demo-mm',
  name: 'Demo',
  poolId: 'uniswap-v3:0xpool',
  marketMaker: 'MM Co',
  addresses: ['0x0000000000000000000000000000000000000001'],
  kpis: {
    minDepthUsd: 1_000,
    bandPct: 2,
    maxSpreadBps: 50,
    spreadNotionalUsd: 10_000,
    targetUptime: 0.95,
  },
  alertWebhookUrl: null,
  alertAfterSamples: 3,
  active: true,
  createdAt: now - 30 * day,
  notes: null,
}

function sample(
  timestamp: number,
  withinKpi: boolean | null,
  attribution: Partial<MmAttribution> = {},
): MmSample {
  return {
    mandateId: mandate.id,
    poolId: mandate.poolId,
    blockNumber: BigInt(timestamp),
    timestamp,
    attribution: {
      method: 'positions',
      holdings: 1,
      shareOfPool: 0.5,
      depthUpUsd: 5_000,
      depthDownUsd: 5_000,
      poolDepthUpUsd: 10_000,
      poolDepthDownUsd: 10_000,
      spreadBps: 20,
      poolSpreadBps: 10,
      ...attribution,
    },
    withinKpi,
    breaches: withinKpi === false ? ['depthUp'] : [],
  }
}

describe('computeUptime', () => {
  it('counts evaluable samples inside (now − window, now]', () => {
    const samples = [
      sample(now - 24 * hour, false), // exactly at the edge: excluded
      sample(now - 23 * hour, true),
      sample(now - 12 * hour, null), // not evaluable: excluded
      sample(now - 6 * hour, false),
      sample(now - 1 * hour, true),
      sample(now, true), // now is included
      sample(now + hour, false), // the future is ignored
    ]
    expect(computeUptime(samples, 24, now)).toEqual({
      windowHours: 24,
      samples: 4,
      withinKpi: 3,
      uptime: 0.75,
    })
    expect(computeUptime(samples, 168, now)).toEqual({
      windowHours: 168,
      samples: 5,
      withinKpi: 3,
      uptime: 0.6,
    })
  })

  it('is null without evaluable samples', () => {
    expect(computeUptime([], 24, now)).toEqual({
      windowHours: 24,
      samples: 0,
      withinKpi: 0,
      uptime: null,
    })
    expect(computeUptime([sample(now, null)], 24, now).uptime).toBeNull()
  })
})

describe('worstExcursions', () => {
  it('finds the minimum depths and the maximum spread with their thresholds', () => {
    const samples = [
      sample(now - 3 * hour, true, { depthUpUsd: 4_000, depthDownUsd: 0, spreadBps: 30 }),
      sample(now - 2 * hour, false, { depthUpUsd: 500, depthDownUsd: 2_000, spreadBps: 80 }),
      sample(now - hour, true, { depthUpUsd: 4_000, depthDownUsd: 3_000, spreadBps: 10 }),
    ]
    const worst = worstExcursions(samples, mandate.kpis)
    expect(worst.minDepthUpUsd).toEqual({
      kind: 'depthUp',
      timestamp: now - 2 * hour,
      blockNumber: BigInt(now - 2 * hour),
      value: 500,
      threshold: 1_000,
    })
    expect(worst.minDepthDownUsd).toMatchObject({ kind: 'depthDown', value: 0, threshold: 1_000 })
    expect(worst.minDepthDownUsd?.timestamp).toBe(now - 3 * hour)
    expect(worst.maxSpreadBps).toEqual({
      kind: 'spread',
      timestamp: now - 2 * hour,
      blockNumber: BigInt(now - 2 * hour),
      value: 80,
      threshold: 50,
    })
  })

  it('a null spread with a spread KPI is the worst value; ties keep the earliest sample', () => {
    const samples = [
      sample(now - 3 * hour, true, { depthUpUsd: 100, spreadBps: 500 }),
      sample(now - 2 * hour, false, { depthUpUsd: 100, spreadBps: null }),
      sample(now - hour, false, { depthUpUsd: 200, spreadBps: null }),
    ]
    const worst = worstExcursions(samples, mandate.kpis)
    expect(worst.maxSpreadBps).toMatchObject({ value: null, timestamp: now - 2 * hour })
    expect(worst.minDepthUpUsd).toMatchObject({ value: 100, timestamp: now - 3 * hour })
  })

  it('skips unevaluable samples and null depths; no spread KPI → no spread excursion', () => {
    const samples = [
      sample(now - 2 * hour, null, { depthUpUsd: 1, depthDownUsd: null, spreadBps: null }),
      sample(now - hour, true, { depthUpUsd: 3_000, depthDownUsd: null, spreadBps: 5 }),
    ]
    const worst = worstExcursions(samples, mandate.kpis)
    expect(worst.minDepthUpUsd?.value).toBe(3_000)
    expect(worst.minDepthDownUsd).toBeNull()
    expect(worst.maxSpreadBps?.value).toBe(5)
    expect(
      worstExcursions(samples, { ...mandate.kpis, maxSpreadBps: null }).maxSpreadBps,
    ).toBeNull()
    expect(worstExcursions([], mandate.kpis)).toEqual({
      minDepthUpUsd: null,
      minDepthDownUsd: null,
      maxSpreadBps: null,
    })
  })
})

describe('currentStreak', () => {
  it('walks back from the newest evaluable sample while withinKpi stays equal', () => {
    const samples = [
      sample(now - 5 * hour, false),
      sample(now - 4 * hour, true),
      sample(now - 3 * hour, false),
      sample(now - 2 * hour, false),
      sample(now - hour, false),
    ]
    expect(currentStreak(samples)).toEqual({ breached: true, samples: 3, since: now - 3 * hour })
    expect(currentStreak(samples.slice(0, 2))).toEqual({
      breached: false,
      samples: 1,
      since: now - 4 * hour,
    })
    expect(currentStreak([sample(now, true), sample(now + 1, true)])).toEqual({
      breached: false,
      samples: 2,
      since: now,
    })
  })

  it('skips unevaluable samples without breaking the streak', () => {
    const samples = [
      sample(now - 4 * hour, true),
      sample(now - 3 * hour, false),
      sample(now - 2 * hour, null),
      sample(now - hour, false),
      sample(now, null),
    ]
    expect(currentStreak(samples)).toEqual({ breached: true, samples: 2, since: now - 3 * hour })
  })

  it('is empty without evaluable samples', () => {
    const empty: BreachStreak = { breached: false, samples: 0, since: null }
    expect(currentStreak([])).toEqual(empty)
    expect(currentStreak([sample(now, null)])).toEqual(empty)
  })
})

describe('scorecardStatus', () => {
  const ok: BreachStreak = { breached: false, samples: 2, since: now - hour }
  const breached: BreachStreak = { breached: true, samples: 2, since: now - hour }

  it('follows inactive → no-data → breached → ok', () => {
    expect(scorecardStatus({ ...mandate, active: false }, sample(now, true), ok)).toBe('inactive')
    expect(scorecardStatus(mandate, null, ok)).toBe('no-data')
    expect(scorecardStatus(mandate, sample(now, false), ok)).toBe('breached')
    expect(scorecardStatus(mandate, sample(now, true), breached)).toBe('ok')
  })

  it('lets the streak decide when the latest sample is not evaluable', () => {
    expect(scorecardStatus(mandate, sample(now, null), breached)).toBe('breached')
    expect(scorecardStatus(mandate, sample(now, null), ok)).toBe('ok')
    expect(
      scorecardStatus(mandate, sample(now, null), { breached: false, samples: 0, since: null }),
    ).toBe('ok')
  })
})

describe('summarizeScorecard', () => {
  it('assembles latest, uptime windows, worst, streak and status (sorting defensively)', () => {
    const samples = [
      sample(now - hour, false, { depthUpUsd: 200 }),
      sample(now - 20 * day, true, { depthUpUsd: 100, spreadBps: 70 }),
      sample(now - 3 * day, null, { depthUpUsd: 1 }),
      sample(now - 2 * day, true),
    ]
    const summary = summarizeScorecard(mandate, samples, now)
    expect(summary.mandate).toBe(mandate)
    expect(summary.latest?.timestamp).toBe(now - hour)
    expect(summary.uptime.h24).toMatchObject({
      windowHours: 24,
      samples: 1,
      withinKpi: 0,
      uptime: 0,
    })
    expect(summary.uptime.d7).toMatchObject({
      windowHours: 168,
      samples: 2,
      withinKpi: 1,
      uptime: 0.5,
    })
    expect(summary.uptime.d30).toMatchObject({ windowHours: 720, samples: 3, withinKpi: 2 })
    expect(summary.uptime.d30.uptime).toBeCloseTo(2 / 3, 12)
    expect(summary.worst.minDepthUpUsd?.value).toBe(100)
    expect(summary.worst.maxSpreadBps?.value).toBe(70)
    expect(summary.streak).toEqual({ breached: true, samples: 1, since: now - hour })
    expect(summary.status).toBe('breached')
  })

  it('reports no-data and an empty streak without samples', () => {
    const summary = summarizeScorecard(mandate, [], now)
    expect(summary.latest).toBeNull()
    expect(summary.status).toBe('no-data')
    expect(summary.streak).toEqual({ breached: false, samples: 0, since: null })
    expect(summary.uptime.h24.uptime).toBeNull()
    expect(summary.worst).toEqual({
      minDepthUpUsd: null,
      minDepthDownUsd: null,
      maxSpreadBps: null,
    })
    expect(summarizeScorecard({ ...mandate, active: false }, [], now).status).toBe('inactive')
  })
})
