import { type PoolMeta, priceDeviationBps } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
  fixtureSnapshot,
  fixtureToken,
} from '../fixtures.js'
import { median } from './scores.js'

const DEGEN = fixtureToken({ address: fixtureAddress(0xdead), symbol: 'DEGEN', name: 'Degen' })

const A: PoolMeta = fixturePool({ address: fixtureAddress(1) }) // uniswap-v3 WETH/USDC
const B: PoolMeta = fixturePool({
  dex: 'aerodrome-v2',
  kind: 'constant-product',
  address: fixtureAddress(2),
  token0: FIXTURE_AERO,
  token1: FIXTURE_USDC,
  tickSpacing: null,
})
const C: PoolMeta = fixturePool({
  dex: 'uniswap-v4',
  address: null,
  poolId: `0x${'cd'.repeat(32)}`,
  token0: DEGEN,
  token1: FIXTURE_WETH,
  hooks: fixtureAddress(0x4004),
})
const D: PoolMeta = fixturePool({
  dex: 'aerodrome-slipstream',
  address: fixtureAddress(4),
  token0: FIXTURE_WETH,
  token1: FIXTURE_AERO,
})
const E: PoolMeta = fixturePool({ address: fixtureAddress(5) }) // unscored uniswap-v3

const ids = (rows: { pool: PoolMeta }[]) => rows.map((r) => r.pool.id)

describe('ScoresRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
    db.pools.upsertMany([A, B, C, D, E])
    db.pools.setTracked([A.id, B.id, D.id], true)
    db.scores.upsertMany([
      fixtureScore({
        poolId: A.id,
        healthTotal: 85,
        gapScore: 10,
        volume24hUsd: 500_000,
        depth2Usd: 1_000_000,
      }),
      fixtureScore({
        poolId: B.id,
        healthTotal: 60,
        gapScore: 75,
        volume24hUsd: 50_000,
        depth2Usd: 20_000,
      }),
      fixtureScore({
        poolId: C.id,
        healthTotal: 30,
        gapScore: null,
        volume24hUsd: null,
        depth2Usd: null,
      }),
      fixtureScore({
        poolId: D.id,
        healthTotal: 60,
        gapScore: 40,
        volume24hUsd: 9_000,
        depth2Usd: 5_000,
      }),
    ])
    db.snapshots.insertMany([
      fixtureSnapshot({
        poolId: A.id,
        timestamp: 200,
        tvlUsd: 2_000_000,
        depth2Usd: 1_000_000,
        spread10kBps: 5,
        ownerTop1Share: 0.3,
        price: 3000,
        blockNumber: 2n ** 100n,
      }),
      fixtureSnapshot({ poolId: A.id, timestamp: 100, tvlUsd: 1_000_000 }),
      fixtureSnapshot({ poolId: B.id, timestamp: 150, tvlUsd: 100_000 }),
      fixtureSnapshot({ poolId: D.id, timestamp: 50, tvlUsd: null }),
    ])
  })
  afterEach(() => db.close())

  it('round-trips a score and overwrites on upsert', () => {
    const score = fixtureScore({
      poolId: A.id,
      timestamp: 123,
      healthTotal: 91.5,
      gapScore: 12.25,
      volume24hUsd: 1,
      depth2Usd: 2,
    })
    score.health.notes = ['persistence neutral: fewer than 3 samples']
    db.scores.upsert(score)
    expect(db.scores.get(A.id)).toEqual(score)
    expect(db.scores.get(A.id)?.health.grade).toBe('A')
    expect(db.scores.get('missing')).toBeUndefined()
    expect(db.scores.count()).toBe(4)
    expect(db.scores.topBy('health').items[0]?.score.health.total).toBe(91.5)
    expect(db.scores.upsertMany([])).toBe(0)
    expect(db.scores.delete(A.id)).toBe(true)
    expect(db.scores.delete(A.id)).toBe(false)
    expect(db.scores.count()).toBe(3)
  })

  it('joins pool metadata and the newest snapshot summary', () => {
    const row = db.scores.getRow(A.id)
    expect(row?.pool).toEqual(A)
    expect(row?.tracked).toBe(true)
    expect(row?.score.health.total).toBe(85)
    expect(row?.latest).toEqual({
      poolId: A.id,
      blockNumber: 2n ** 100n,
      updatedAt: 200,
      price: 3000,
      tvlUsd: 2_000_000,
      depth2Usd: 1_000_000,
      spread10kBps: 5,
      ownerTop1Share: 0.3,
      depth2UpUsd: 500_000,
      depth2DownUsd: 500_000,
      priceDeviationBps: priceDeviationBps(3000, 3000.25, 1),
    })
    expect(db.scores.getRow(C.id)?.latest).toBeNull()
    expect(db.scores.getRow(C.id)?.tracked).toBe(false)
    expect(db.scores.getRow(D.id)?.latest?.tvlUsd).toBeNull()
    expect(db.scores.getRow(E.id)).toBeUndefined()
  })

  it('sorts by each field in both directions with nulls last and stable tie-breaks', () => {
    expect(ids(db.scores.topBy('health').items)).toEqual([A.id, D.id, B.id, C.id])
    expect(ids(db.scores.topBy('health', { dir: 'asc' }).items)).toEqual([C.id, D.id, B.id, A.id])
    expect(ids(db.scores.topBy('gap').items)).toEqual([B.id, D.id, A.id, C.id])
    expect(ids(db.scores.topBy('gap', { dir: 'asc' }).items)).toEqual([A.id, D.id, B.id, C.id])
    expect(ids(db.scores.topBy('depth').items)).toEqual([A.id, B.id, D.id, C.id])
    expect(ids(db.scores.topBy('depth', { dir: 'asc' }).items)).toEqual([D.id, B.id, A.id, C.id])
    expect(ids(db.scores.topBy('volume').items)).toEqual([A.id, B.id, D.id, C.id])
    expect(ids(db.scores.topBy('volume', { dir: 'asc' }).items)).toEqual([D.id, B.id, A.id, C.id])
    expect(ids(db.scores.topBy('tvl').items)).toEqual([A.id, B.id, D.id, C.id])
    expect(ids(db.scores.topBy('tvl', { dir: 'asc' }).items)).toEqual([B.id, A.id, D.id, C.id])
    expect(db.scores.topBy('health').total).toBe(4)
  })

  it('rejects anything outside the sort/dir whitelists', () => {
    expect(() => db.scores.topBy('price; DROP TABLE scores' as never)).toThrow(RangeError)
    expect(() => db.scores.topBy('health', { dir: 'DESC' as never })).toThrow(RangeError)
    expect(() => db.scores.topBy('toString' as never)).toThrow(RangeError)
    expect(db.scores.count()).toBe(4)
  })

  it('filters by dex, q, minVolumeUsd and tracked, reporting the unpaged total', () => {
    expect(db.scores.topBy('health', { dex: 'uniswap-v3' })).toMatchObject({ total: 1 })
    expect(ids(db.scores.topBy('health', { dex: 'uniswap-v3' }).items)).toEqual([A.id])
    expect(ids(db.scores.topBy('health', { dex: 'aerodrome-v2' }).items)).toEqual([B.id])

    expect(ids(db.scores.topBy('health', { q: 'aero' }).items)).toEqual([D.id, B.id])
    expect(ids(db.scores.topBy('health', { q: 'usdc' }).items)).toEqual([A.id, B.id])
    expect(ids(db.scores.topBy('health', { q: DEGEN.address }).items)).toEqual([C.id])
    expect(ids(db.scores.topBy('health', { q: fixtureAddress(2) }).items)).toEqual([B.id])
    expect(ids(db.scores.topBy('health', { q: 'cdcdcd' }).items)).toEqual([C.id])
    expect(db.scores.topBy('health', { q: 'zzz' })).toEqual({ items: [], total: 0 })
    // token: exactly token0 or token1, whatever a symbol spells
    db.tokens.upsertMany([{ ...DEGEN, symbol: FIXTURE_USDC.address }])
    expect(ids(db.scores.topBy('health', { q: FIXTURE_USDC.address }).items)).toEqual([
      A.id,
      B.id,
      C.id,
    ])
    const byToken = db.scores.topBy('health', { token: FIXTURE_USDC.address })
    expect(ids(byToken.items)).toEqual([A.id, B.id])
    expect(byToken.total).toBe(2)
    expect(ids(db.scores.topBy('tvl', { token: FIXTURE_WETH.address, dir: 'asc' }).items)).toEqual(
      ids(db.scores.topBy('tvl', { dir: 'asc' }).items).filter((id) => id !== B.id),
    )
    expect(db.scores.topBy('health', { token: fixtureAddress(0x999) })).toEqual({
      items: [],
      total: 0,
    })

    const byVolume = db.scores.topBy('volume', { minVolumeUsd: 10_000 })
    expect(ids(byVolume.items)).toEqual([A.id, B.id])
    expect(byVolume.total).toBe(2)
    expect(ids(db.scores.topBy('volume', { minVolumeUsd: 9_000 }).items)).toEqual([
      A.id,
      B.id,
      D.id,
    ])
    expect(ids(db.scores.topBy('volume', { minVolumeUsd: 0 }).items)).toEqual([A.id, B.id, D.id])

    expect(ids(db.scores.topBy('health', { tracked: true }).items)).toEqual([A.id, D.id, B.id])
    expect(ids(db.scores.topBy('health', { tracked: false }).items)).toEqual([C.id])
    const combined = db.scores.topBy('health', { q: 'weth', tracked: true, minVolumeUsd: 1 })
    expect(ids(combined.items)).toEqual([A.id, D.id])
    expect(combined.total).toBe(2)
  })

  it('pages with limit/offset while total stays unpaged', () => {
    const first = db.scores.topBy('health', { limit: 2 })
    expect(ids(first.items)).toEqual([A.id, D.id])
    expect(first.total).toBe(4)
    const second = db.scores.topBy('health', { limit: 2, offset: 2 })
    expect(ids(second.items)).toEqual([B.id, C.id])
    expect(second.total).toBe(4)
    expect(db.scores.topBy('health', { limit: 2, offset: 4 })).toEqual({ items: [], total: 4 })
    expect(db.scores.topBy('health', { limit: 0 }).items).toEqual([])
    expect(() => db.scores.topBy('health', { limit: -1 })).toThrow(RangeError)
    expect(() => db.scores.topBy('health', { offset: -1 })).toThrow(RangeError)
  })

  it('lists gaps above the volume threshold, best gap score first', () => {
    expect(ids(db.scores.gaps())).toEqual([B.id, A.id])
    expect(db.scores.gaps().map((r) => r.score.gap.gapScore)).toEqual([75, 10])
    expect(db.scores.gaps()[0]?.latest?.tvlUsd).toBe(100_000)
    expect(ids(db.scores.gaps({ minVolumeUsd: 5_000 }))).toEqual([B.id, D.id, A.id])
    expect(ids(db.scores.gaps({ minVolumeUsd: 5_000, limit: 1 }))).toEqual([B.id])
    expect(ids(db.scores.gaps({ minVolumeUsd: 5_000, limit: 1, offset: 1 }))).toEqual([D.id])
    expect(ids(db.scores.gaps({ minVolumeUsd: 1_000_000 }))).toEqual([])
    // volume exactly at the threshold is included; null gap scores never are
    expect(ids(db.scores.gaps({ minVolumeUsd: 50_000 }))).toEqual([B.id, A.id])
    db.scores.upsert(fixtureScore({ poolId: E.id, gapScore: null, volume24hUsd: 1_000_000 }))
    expect(ids(db.scores.gaps())).toEqual([B.id, A.id])
  })

  it('aggregates per dex with medians over scored pools', () => {
    const stats = db.scores.statsByDex()
    expect(stats.map((s) => s.dex)).toEqual([
      'uniswap-v3',
      'uniswap-v4',
      'aerodrome-v2',
      'aerodrome-slipstream',
      'aero-v2',
      'aero-slipstream',
    ])
    expect(stats[0]).toEqual({
      dex: 'uniswap-v3',
      pools: 2,
      tracked: 1,
      scored: 1,
      rated: 1,
      depth2UsdSum: 1_000_000,
      depthKnownPools: 1,
      volume24hUsdSum: 500_000,
      medianHealth: 85,
    })
    expect(stats[1]).toEqual({
      dex: 'uniswap-v4',
      pools: 1,
      tracked: 0,
      scored: 1,
      rated: 1,
      depth2UsdSum: 0,
      // C has no known depth: nothing to sum
      depthKnownPools: 0,
      // C's volume is unknown and it is the only v4 pool: the sum is unknown, not 0
      volume24hUsdSum: null,
      medianHealth: 30,
    })
    expect(stats[2]).toMatchObject({ dex: 'aerodrome-v2', pools: 1, tracked: 1, medianHealth: 60 })
    expect(stats[3]).toMatchObject({
      dex: 'aerodrome-slipstream',
      pools: 1,
      tracked: 1,
      medianHealth: 60,
    })

    // even count → mean of the two middle values; three values → middle one; none → null
    db.scores.upsert(fixtureScore({ poolId: E.id, healthTotal: 65, volume24hUsd: 1, depth2Usd: 2 }))
    expect(db.scores.statsByDex()[0]).toMatchObject({
      scored: 2,
      medianHealth: 75,
      depth2UsdSum: 1_000_002,
      volume24hUsdSum: 500_001,
    })
    const F = fixturePool({ address: fixtureAddress(6) })
    db.pools.upsertMany([F])
    db.scores.upsert(fixtureScore({ poolId: F.id, healthTotal: 10 }))
    expect(db.scores.statsByDex()[0]).toMatchObject({ pools: 3, scored: 3, medianHealth: 65 })
    db.scores.delete(C.id)
    expect(db.scores.statsByDex()[1]).toMatchObject({ pools: 1, scored: 0, medianHealth: null })
  })

  it('puts unrated pools after the rated ones in both health directions', () => {
    // D scores 90 but is thin: its total is kept, its place is behind every rated pool
    db.scores.upsert(
      fixtureScore({
        poolId: D.id,
        healthTotal: 90,
        unratedReason: 'thin',
        gapScore: 40,
        volume24hUsd: 9_000,
        depth2Usd: 5_000,
      }),
    )
    expect(ids(db.scores.topBy('health').items)).toEqual([A.id, B.id, C.id, D.id])
    expect(ids(db.scores.topBy('health', { dir: 'asc' }).items)).toEqual([C.id, B.id, A.id, D.id])
    expect(db.scores.getRow(D.id)?.score.health).toMatchObject({
      total: 90,
      grade: null,
      rated: false,
      unratedReason: 'thin',
    })
    // other sorts do not care about the rating
    expect(ids(db.scores.topBy('gap').items)).toEqual([B.id, D.id, A.id, C.id])
    // the filter splits the list and its total
    const rated = db.scores.topBy('health', { rated: true })
    expect(ids(rated.items)).toEqual([A.id, B.id, C.id])
    expect(rated.total).toBe(3)
    const unrated = db.scores.topBy('health', { rated: false })
    expect(ids(unrated.items)).toEqual([D.id])
    expect(unrated.total).toBe(1)
    expect(db.scores.topBy('health', { rated: false, dex: 'uniswap-v3' })).toEqual({
      items: [],
      total: 0,
    })
    expect(db.scores.topBy('health').total).toBe(4)
  })

  it('takes medians and the rated count over rated pools only', () => {
    // totals 85, 70, 55 rated and 20, 12 unrated: the median is 70, not the 55 of all five
    const fresh = openDatabase(':memory:')
    try {
      const pools = [1, 2, 3, 4, 5].map((n) => fixturePool({ address: fixtureAddress(0x100 + n) }))
      fresh.pools.upsertMany(pools)
      const totals = [85, 70, 55, 20, 12]
      fresh.scores.upsertMany(
        pools.map((pool, i) =>
          fixtureScore({
            poolId: pool.id,
            healthTotal: totals[i] ?? 0,
            unratedReason: i >= 3 ? 'one-sided' : null,
          }),
        ),
      )
      expect(fresh.scores.statsByDex()[0]).toMatchObject({ scored: 5, rated: 3, medianHealth: 70 })
      expect(fresh.scores.medianRatedHealth()).toBe(70)
      // nothing rated: no median, but the pools are still scored
      fresh.raw.exec(
        `UPDATE scores SET health_json = json_set(health_json, '$.rated', json('false'))`,
      )
      expect(fresh.scores.statsByDex()[0]).toMatchObject({
        scored: 5,
        rated: 0,
        medianHealth: null,
      })
      expect(fresh.scores.medianRatedHealth()).toBeNull()
    } finally {
      fresh.close()
    }
  })

  it('reads a score stored before ratings existed as unrated, without a grade', () => {
    db.raw.exec(
      `UPDATE scores SET health_json = json_remove(health_json, '$.rated', '$.unratedReason') WHERE pool_id = '${A.id}'`,
    )
    expect(db.scores.get(A.id)?.health).toMatchObject({
      total: 85,
      grade: null,
      rated: false,
      unratedReason: null,
    })
    expect(db.scores.statsByDex()[0]).toMatchObject({ scored: 1, rated: 0, medianHealth: null })
    expect(ids(db.scores.topBy('health', { rated: true }).items)).toEqual([D.id, B.id, C.id])
  })

  it('reads a score stored before the concentration basis existed with a null basis', () => {
    expect(db.scores.get(A.id)?.health.concentrationBasis).toBe('owners')
    db.raw.exec(
      `UPDATE scores SET health_json = json_remove(health_json, '$.concentrationBasis') WHERE pool_id = '${A.id}'`,
    )
    expect(db.scores.get(A.id)?.health).toMatchObject({ grade: 'A', concentrationBasis: null })
    expect(db.scores.getRow(A.id)?.score.health.concentrationBasis).toBeNull()
  })

  it('serves the $10k spread of a snapshot stored before the cap as null, not 1e24 bps', () => {
    // Pool A's newest snapshot as the first live run wrote it: the uncapped spread in the column
    // and in the point, and a different value for B's, within the cap, to show reads follow the point.
    const legacy = JSON.stringify([
      {
        notionalUsd: 1_000,
        spreadBps: 4,
        feasible: true,
        buyAvgPrice: 3000.5,
        sellAvgPrice: 2999.5,
      },
      {
        notionalUsd: 10_000,
        spreadBps: 1.449e24,
        feasible: true,
        buyAvgPrice: 4.3e27,
        sellAvgPrice: 1.2e-21,
      },
    ])
    db.raw
      .prepare(
        'UPDATE snapshots SET spreads_json = ?, spread10k_bps = ? WHERE pool_id = ? AND timestamp = ?',
      )
      .run(legacy, 1.449e24, A.id, 200)
    db.raw.prepare('UPDATE snapshots SET spread10k_bps = 1 WHERE pool_id = ?').run(B.id)

    expect(db.scores.getRow(A.id)?.latest?.spread10kBps).toBeNull()
    const listed = db.scores.topBy('health').items
    expect(listed.find((row) => row.pool.id === A.id)?.latest?.spread10kBps).toBeNull()
    const gaps = db.scores.gaps({ minVolumeUsd: 0 })
    expect(gaps.find((row) => row.pool.id === A.id)?.latest?.spread10kBps).toBeNull()
    // B's is the 12 bps of its point, not the stale 1 of the column
    expect(db.scores.getRow(B.id)?.latest?.spread10kBps).toBe(12)
  })

  it('computes medians', () => {
    expect(median([])).toBeNull()
    expect(median([4])).toBe(4)
    expect(median([1, 3])).toBe(2)
    expect(median([1, 2, 10])).toBe(2)
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })

  it('deletes the scores of untracked and unknown pools', () => {
    db.scores.upsert(fixtureScore({ poolId: 'orphan:0x00', healthTotal: 99 }))
    expect(db.scores.count()).toBe(5)
    // C is scored but untracked; the orphan has no pool row
    expect(db.scores.deleteUntracked()).toBe(2)
    expect(db.scores.get(C.id)).toBeUndefined()
    expect(ids(db.scores.topBy('health').items)).toEqual([A.id, D.id, B.id])
    expect(db.scores.deleteUntracked()).toBe(0)
    db.pools.setTracked([B.id], false)
    expect(db.scores.deleteUntracked()).toBe(1)
    expect(db.scores.count()).toBe(2)
    expect(ids(db.scores.gaps())).toEqual([A.id])
  })

  it('ignores unscored pools and scores without pool metadata', () => {
    db.scores.upsert(fixtureScore({ poolId: 'orphan:0x00', healthTotal: 99 }))
    expect(ids(db.scores.topBy('health').items)).toEqual([A.id, D.id, B.id, C.id])
    expect(db.scores.topBy('health').total).toBe(4)
    expect(db.scores.statsByDex().reduce((n, s) => n + s.scored, 0)).toBe(4)
  })
})
