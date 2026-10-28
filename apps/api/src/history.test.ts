import {
  computeHealthScore,
  computePersistence,
  NOTE_PERSISTENCE_NEUTRAL,
  NOTE_PERSISTENCE_SHORT,
  type PoolSnapshot,
} from '@depthwatch/core'
import {
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixturePool,
  openDatabase,
  snapshotHealthSummary,
} from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { buildHistoryPoints, HEALTH_PERSISTENCE_SECONDS, type HistoryInput } from './history.js'
import { buildSnapshot } from './testing/builders.js'

const HOUR = 3600
/** Snapshots 3 h apart: four of them span the 6 h a 24 h persistence needs (docs/METRICS.md). */
const STEP = 3 * HOUR
const T0 = 1_700_000_000
const pool = fixturePool({ token0: FIXTURE_WETH, token1: FIXTURE_USDC })

function snapshotAt(timestamp: number, depth2Usd: number | null): HistoryInput {
  return snapshotHealthSummary(rawSnapshotAt(timestamp, depth2Usd))
}

function rawSnapshotAt(timestamp: number, depth2Usd: number | null): PoolSnapshot {
  return buildSnapshot({
    pool,
    timestamp,
    blockNumber: BigInt(timestamp),
    price: 3000,
    decimals0: 18,
    decimals1: 6,
    token0Usd: depth2Usd === null ? null : 3000,
    token1Usd: depth2Usd === null ? null : 1,
    tvlUsd: depth2Usd === null ? null : depth2Usd * 10,
    depth2Usd,
    depth2Token1: depth2Usd === null ? 100 : undefined,
    spread10kBps: depth2Usd === null ? null : 10,
    ownerTop1Share: 0.4,
  })
}

describe('buildHistoryPoints', () => {
  const series = [
    snapshotAt(T0, 100_000),
    snapshotAt(T0 + STEP, 120_000),
    snapshotAt(T0 + 2 * STEP, 90_000),
    snapshotAt(T0 + 3 * STEP, 110_000),
    snapshotAt(T0 + 4 * STEP, 105_000),
  ]

  it('emits only snapshots at or after `from` while using earlier ones for persistence', () => {
    const from = T0 + 3 * STEP
    const points = buildHistoryPoints(series, from)
    expect(points.map((p) => p.timestamp)).toEqual([T0 + 3 * STEP, T0 + 4 * STEP])
    const first = points[0]
    expect(first).toMatchObject({
      price: 3000,
      depth2Usd: 110_000,
      spread10kBps: 10,
      tvlUsd: 1_100_000,
    })
    const samples = series
      .slice(0, 4)
      .map((s) => ({ timestamp: s.updatedAt, depthUsd: s.depth2Usd }))
    const expected = computeHealthScore({
      depth2UpUsd: 55_000,
      depth2DownUsd: 55_000,
      spread10kBps: 10,
      ownerTop1Share: 0.4,
      rangeHhi: 0.28,
      persistence: computePersistence(samples, 24, from),
    })
    expect(expected.notes).not.toContain(NOTE_PERSISTENCE_NEUTRAL)
    expect(expected.notes).not.toContain(NOTE_PERSISTENCE_SHORT)
    expect(first?.health).toBe(expected.total)
  })

  it('scores persistence neutral with fewer than three trailing samples', () => {
    const points = buildHistoryPoints(series.slice(0, 2), T0)
    expect(points).toHaveLength(2)
    const neutral = computeHealthScore({
      depth2UpUsd: 50_000,
      depth2DownUsd: 50_000,
      spread10kBps: 10,
      ownerTop1Share: 0.4,
      rangeHhi: 0.28,
      persistence: null,
    })
    expect(points[0]?.health).toBe(neutral.total)
  })

  it('drops samples older than the persistence window', () => {
    const old = snapshotAt(T0 - HEALTH_PERSISTENCE_SECONDS - HOUR, 1)
    const stale = snapshotAt(T0 - HEALTH_PERSISTENCE_SECONDS, 1)
    const withLeadIn = buildHistoryPoints([old, stale, ...series], T0 + 4 * STEP)
    const without = buildHistoryPoints(series, T0 + 4 * STEP)
    expect(withLeadIn).toEqual(without)
  })

  it('reports nulls for unpriced snapshots and still scores them', () => {
    const points = buildHistoryPoints([snapshotAt(T0, null)], T0)
    expect(points[0]).toMatchObject({ depth2Usd: null, spread10kBps: null, tvlUsd: null })
    // depth 0 + spread 0 + concentration 20·(1−0.4) + neutral persistence 10
    expect(points[0]?.health).toBe(22)
  })

  it('persistence is neutral while the snapshots span under a quarter of the window', () => {
    const close = [0, 1, 2, 3].map((i) => snapshotAt(T0 + i * 600, 100_000)) // 30 minutes
    const [last] = buildHistoryPoints(close, T0 + 3 * 600)
    const neutral = computeHealthScore({
      depth2UpUsd: 50_000,
      depth2DownUsd: 50_000,
      spread10kBps: 10,
      ownerTop1Share: 0.4,
      rangeHhi: 0.28,
      persistence: null,
    })
    expect(last?.health).toBe(neutral.total)
  })

  it('is empty without snapshots', () => {
    expect(buildHistoryPoints([], T0)).toEqual([])
  })

  it('builds the same points from the stored summary series as from the snapshots', () => {
    const db = openDatabase(':memory:')
    try {
      const raw = [
        rawSnapshotAt(T0 - HEALTH_PERSISTENCE_SECONDS - HOUR, 1),
        ...[0, 1, 2, 3, 4].map((i) => rawSnapshotAt(T0 + i * STEP, i === 2 ? null : 100_000 + i)),
      ]
      db.snapshots.insertMany(raw)
      const from = T0 + STEP
      const stored = db.snapshots.seriesSummaryForPool(
        pool.id,
        from - HEALTH_PERSISTENCE_SECONDS,
        T0 + 4 * STEP,
      )
      expect(stored).toHaveLength(5)
      const fromStore = buildHistoryPoints(stored, from)
      const fromSnapshots = buildHistoryPoints(raw.map(snapshotHealthSummary), from)
      expect(fromStore).toEqual(fromSnapshots)
      expect(fromStore.map((p) => p.timestamp)).toEqual([1, 2, 3, 4].map((i) => T0 + i * STEP))
      expect(fromStore[1]).toMatchObject({ depth2Usd: null, tvlUsd: null, spread10kBps: null })
      expect(fromStore[2]?.depth2Usd).toBe(100_003)
    } finally {
      db.close()
    }
  })
})
