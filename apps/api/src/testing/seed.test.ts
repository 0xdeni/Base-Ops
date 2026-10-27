import { currentStreak, evaluateKpis, summarizeScorecard } from '@depthwatch/core'
import { snapshotSummaryFields } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { buildGap, humanToRaw } from './builders.js'
import {
  createSeededDatabase,
  SEED_MM_BREACHED_ID,
  SEED_MM_OK_ID,
  SEED_NOW,
  seedDatabase,
} from './seed.js'

describe('seed', () => {
  it('is deterministic', () => {
    const a = createSeededDatabase()
    const b = createSeededDatabase()
    try {
      expect(a.seed.scoredIds).toEqual(b.seed.scoredIds)
      expect(JSON.stringify([...a.seed.scores])).toBe(JSON.stringify([...b.seed.scores]))
      expect(a.db.snapshots.count()).toBe(b.db.snapshots.count())
      expect(a.db.pools.listRecords()).toEqual(b.db.pools.listRecords())
    } finally {
      a.db.close()
      b.db.close()
    }
  })

  it('writes every table consistently', () => {
    const { db, seed } = createSeededDatabase()
    try {
      expect(db.tokens.count()).toBe(6)
      expect(db.pools.count()).toBe(7)
      expect(db.pools.trackedIds().sort()).toEqual([...seed.scoredIds].sort())
      expect(db.scores.count()).toBe(6)
      expect(db.snapshots.count()).toBe(97 + 5 * 3)
      expect(db.volume.count()).toBe(6 * 24 + 2)
      expect(db.prices.count()).toBe(4)
      expect(db.positions.countForPool(seed.pools.wethUsdcV3.id)).toBe(3)
      expect(db.syncState.getBigInt('discover:uniswap-v4:lastBlock')).toBe(20_000_000n)
      expect(db.snapshots.latestTimestamp()).toBe(SEED_NOW)
      expect(db.mandates.count()).toBe(2)
      expect(db.mmSamples.count()).toBe(99 + 25)
      expect(db.mmAlerts.count()).toBe(0)
    } finally {
      db.close()
    }
  })

  it('keeps scores, snapshots and volume in agreement', () => {
    const { db, seed } = createSeededDatabase()
    try {
      for (const id of seed.scoredIds) {
        const score = db.scores.get(id)
        const latest = db.snapshots.latestForPool(id)
        expect(score, id).toBeDefined()
        expect(latest, id).toBeDefined()
        if (!score || !latest) continue
        const fields = snapshotSummaryFields(latest)
        expect(fields.depth2Usd).toBe(score.depth2Usd)
        expect(score.gap).toEqual(buildGap(score.volume24hUsd, score.depth2Usd))
        expect(score.health.grade).toBe(db.scores.getRow(id)?.score.health.grade)
        const volume = db.volume.sumUsd(id, SEED_NOW - 86_400, SEED_NOW)
        if (score.volume24hUsd === null) expect(volume).toBeNull()
        else expect(volume).toBeCloseTo(score.volume24hUsd, 6)
      }
    } finally {
      db.close()
    }
  })

  it('models the unpriced pool with nulls everywhere', () => {
    const { db, seed } = createSeededDatabase()
    try {
      const id = seed.pools.brettToshiV3.id
      const latest = db.snapshots.latestForPool(id)
      expect(latest?.token0Usd).toBeNull()
      expect(latest?.depthUsd.every((level) => level.totalUsd === null)).toBe(true)
      expect(latest?.spreads.every((point) => !point.feasible)).toBe(true)
      expect(latest?.depth.every((level) => level.up.amountIn > 0n)).toBe(true)
      const score = db.scores.get(id)
      expect(score?.gap.gapScore).toBeNull()
      expect(score?.persistence24h.stability).toBeNull()
      expect(db.prices.usd(seed.tokens.BRETT.address)).toBeNull()
    } finally {
      db.close()
    }
  })

  it('honours a custom now', () => {
    const { db, seed } = createSeededDatabase({ now: 1_800_000_000 })
    try {
      expect(seed.now).toBe(1_800_000_000)
      expect(db.snapshots.latestTimestamp()).toBe(1_800_000_000)
      expect(db.scores.get(seed.pools.wethUsdcV3.id)?.timestamp).toBe(1_800_000_000)
    } finally {
      db.close()
    }
  })

  it('seedDatabase returns the inserted rows for assertions', () => {
    const { db, seed } = createSeededDatabase()
    try {
      const rows = seed.snapshots.get(seed.pools.wethUsdcV3.id)
      expect(rows).toHaveLength(97)
      expect(rows?.at(-1)?.timestamp).toBe(SEED_NOW)
      expect(seed.scores.get(seed.pools.wethUsdcV3.id)?.health.total).toBe(85)
      expect(seedDatabase).toBeTypeOf('function')
    } finally {
      db.close()
    }
  })
})

describe('builders', () => {
  it('humanToRaw expands decimals without float error', () => {
    expect(humanToRaw(1, 18)).toBe(10n ** 18n)
    expect(humanToRaw(0.1, 18)).toBe(10n ** 17n)
    expect(humanToRaw(3000.25, 6)).toBe(3_000_250_000n)
    expect(humanToRaw(0, 6)).toBe(0n)
    expect(humanToRaw(250_020.8333333333, 18)).toBe(250_020_833_333_333_000_000_000n)
    expect(humanToRaw(1e-9, 6)).toBe(0n)
    expect(humanToRaw(12_345_678.9, 0)).toBe(12_345_678n)
    expect(() => humanToRaw(-1, 6)).toThrow(RangeError)
  })

  it('buildGap follows DESIGN.md', () => {
    expect(buildGap(100, 100).gapScore).toBe(0)
    expect(buildGap(10_000, 100).gapScore).toBe(100)
    expect(buildGap(1_000, 100).gapScore).toBeCloseTo(50, 9)
    expect(buildGap(null, 100).gapScore).toBeNull()
    expect(buildGap(100, 0)).toEqual({
      volume24hUsd: 100,
      depth2Usd: 0,
      turnoverRatio: null,
      gapScore: null,
    })
  })
})

describe('seed mandates', () => {
  const DAY = 86_400

  it('registers the two demo-named mandates on seed pools, addresses lowercase', () => {
    const { db, seed } = createSeededDatabase()
    try {
      expect(seed.mandates.slipstreamOk.id).toBe(SEED_MM_OK_ID)
      expect(seed.mandates.aeroBreached.id).toBe(SEED_MM_BREACHED_ID)
      expect(db.mandates.list().map((m) => m.id)).toEqual([SEED_MM_BREACHED_ID, SEED_MM_OK_ID])
      expect(db.mandates.get(SEED_MM_OK_ID)).toEqual(seed.mandates.slipstreamOk)
      expect(db.mandates.get(SEED_MM_BREACHED_ID)).toEqual(seed.mandates.aeroBreached)
      expect(seed.mandates.slipstreamOk.poolId).toBe(seed.pools.wethAeroSlip.id)
      expect(seed.mandates.aeroBreached.poolId).toBe(seed.pools.aeroUsdcV2.id)
      expect(db.pools.get(seed.mandates.slipstreamOk.poolId)?.dex).toBe('aerodrome-slipstream')
      expect(db.pools.get(seed.mandates.aeroBreached.poolId)?.dex).toBe('aerodrome-v2')
      for (const mandate of Object.values(seed.mandates)) {
        expect(mandate.active).toBe(true)
        expect(mandate.alertWebhookUrl).toBeNull()
        for (const address of mandate.addresses) expect(address).toMatch(/^0x[0-9a-f]{40}$/)
      }
    } finally {
      db.close()
    }
  })

  it('stores samples whose evaluation agrees with core evaluateKpis', () => {
    const { db, seed } = createSeededDatabase()
    try {
      for (const mandate of Object.values(seed.mandates)) {
        const inserted = seed.mmSamples.get(mandate.id) ?? []
        const stored = db.mmSamples.seriesFor(mandate.id, 0)
        expect(stored).toEqual(inserted)
        for (const sample of stored) {
          expect(sample.poolId).toBe(mandate.poolId)
          expect(sample.blockNumber).toBeLessThanOrEqual(20_000_000n)
          expect(evaluateKpis(sample.attribution, mandate.kpis)).toEqual({
            withinKpi: sample.withinKpi,
            breaches: sample.breaches,
          })
        }
        for (let i = 1; i < stored.length; i++)
          expect(stored[i]!.timestamp).toBeGreaterThan(stored[i - 1]!.timestamp)
        expect(stored.at(-1)?.timestamp).toBe(SEED_NOW)
      }
    } finally {
      db.close()
    }
  })

  it('makes the Slipstream mandate ok and the Aerodrome one breached', () => {
    const { db, seed } = createSeededDatabase()
    try {
      const okSamples = db.mmSamples.seriesFor(SEED_MM_OK_ID, SEED_NOW - 30 * DAY)
      const ok = summarizeScorecard(seed.mandates.slipstreamOk, okSamples, SEED_NOW)
      expect(ok.status).toBe('ok')
      expect(okSamples).toHaveLength(97)
      expect(db.mmSamples.countFor(SEED_MM_OK_ID)).toBe(99)
      expect(okSamples.filter((s) => s.withinKpi === null)).toHaveLength(1)
      expect(okSamples.filter((s) => s.withinKpi === false)).toHaveLength(3)
      expect(ok.uptime.h24).toEqual({ windowHours: 24, samples: 12, withinKpi: 12, uptime: 1 })
      expect(ok.uptime.d7).toMatchObject({ samples: 83, withinKpi: 80 })
      expect(ok.uptime.d30).toMatchObject({ samples: 96, withinKpi: 93 })
      expect(ok.streak).toEqual({
        breached: false,
        samples: 58,
        since: SEED_NOW - 8 * DAY + 78 * 3600,
      })
      expect(ok.worst.minDepthDownUsd).toMatchObject({
        kind: 'depthDown',
        value: 42_000,
        threshold: 50_000,
      })
      expect(ok.worst.maxSpreadBps).toBeNull()

      const badSamples = db.mmSamples.seriesFor(SEED_MM_BREACHED_ID, SEED_NOW - 30 * DAY)
      const bad = summarizeScorecard(seed.mandates.aeroBreached, badSamples, SEED_NOW)
      expect(bad.status).toBe('breached')
      expect(badSamples).toHaveLength(25)
      expect(bad.uptime.h24).toEqual({ windowHours: 24, samples: 12, withinKpi: 0, uptime: 0 })
      expect(bad.uptime.d7).toMatchObject({ samples: 25, withinKpi: 6, uptime: 0.24 })
      expect(bad.streak).toEqual(currentStreak(badSamples))
      expect(bad.streak).toMatchObject({ breached: true, samples: 19 })
      expect(bad.latest?.breaches).toEqual(['depthUp', 'depthDown'])
      expect(bad.worst.maxSpreadBps?.value).toBeLessThan(40)
    } finally {
      db.close()
    }
  })
})
