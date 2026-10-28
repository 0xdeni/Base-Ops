import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_BIG, fixtureSnapshot } from '../fixtures.js'
import { snapshotDepthSides, snapshotSummary, snapshotSummaryFields } from '../summary.js'

const A = 'uniswap-v3:0x000000000000000000000000000000000000000a'
const B = 'aerodrome-v2:0x000000000000000000000000000000000000000b'

describe('SnapshotsRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips a snapshot with 2^100-scale bigints intact', () => {
    const snapshot = fixtureSnapshot({
      poolId: A,
      blockNumber: FIXTURE_BIG * 7n + 1n,
      activeLiquidity: FIXTURE_BIG * 11n,
      timestamp: 1_700_000_123,
    })
    const id = db.snapshots.insert(snapshot)
    expect(id).toBe(1)
    const stored = db.snapshots.latestForPool(A)
    expect(stored).toEqual(snapshot)
    expect(stored?.blockNumber).toBe(FIXTURE_BIG * 7n + 1n)
    expect(stored?.activeLiquidity).toBe(FIXTURE_BIG * 11n)
    expect(stored?.depth[1]?.up.amountIn).toBe(FIXTURE_BIG * 2n)
    expect(stored?.depth[1]?.down.amountIn).toBe(FIXTURE_BIG * 2n + 1n)
    expect(typeof stored?.depth[0]?.up.amountOut).toBe('bigint')
    expect(stored?.depth[2]?.down.reached).toBe(false)
    expect(db.snapshots.count()).toBe(1)
  })

  it('stores null concentration and unpriced ladders', () => {
    const snapshot = fixtureSnapshot({
      poolId: A,
      concentration: null,
      depth2Usd: null,
      spread10kBps: null,
      token0Usd: null,
      token1Usd: null,
      tvlUsd: null,
    })
    db.snapshots.insert(snapshot)
    const stored = db.snapshots.latestForPool(A)
    expect(stored).toEqual(snapshot)
    expect(stored?.concentration).toBeNull()
    expect(stored?.depthUsd.every((l) => l.totalUsd === null)).toBe(true)
    expect(db.snapshots.latestSummaryForPools([A]).get(A)).toEqual({
      poolId: A,
      blockNumber: snapshot.blockNumber,
      updatedAt: snapshot.timestamp,
      price: snapshot.price,
      tvlUsd: null,
      depth2Usd: null,
      spread10kBps: null,
      ownerTop1Share: null,
      depth2UpUsd: null,
      depth2DownUsd: null,
      priceDeviationBps: null,
    })
  })

  it('derives the summary fields from the metric ladders', () => {
    const snapshot = fixtureSnapshot({ depth2Usd: 4321, spread10kBps: 7.5, ownerTop1Share: 0.33 })
    expect(snapshotSummaryFields(snapshot)).toEqual({
      depth2Usd: 4321,
      spread10kBps: 7.5,
      ownerTop1Share: 0.33,
    })
    expect(snapshotSummary(snapshot)).toEqual({
      poolId: snapshot.poolId,
      blockNumber: snapshot.blockNumber,
      updatedAt: snapshot.timestamp,
      price: snapshot.price,
      tvlUsd: snapshot.tvlUsd,
      depth2Usd: 4321,
      spread10kBps: 7.5,
      ownerTop1Share: 0.33,
      depth2UpUsd: 2160.5,
      depth2DownUsd: 2160.5,
      priceDeviationBps: 0,
    })
    const bare = fixtureSnapshot({ depthUsd: [], spreads: [], concentration: null })
    expect(snapshotSummaryFields(bare)).toEqual({
      depth2Usd: null,
      spread10kBps: null,
      ownerTop1Share: null,
    })
    expect(snapshotDepthSides(bare)).toEqual({ depth2UpUsd: null, depth2DownUsd: null })
    const ownerless = fixtureSnapshot({ ownerTop1Share: null })
    expect(snapshotSummaryFields(ownerless).ownerTop1Share).toBeNull()
  })

  it('reads a spread stored before the price impact cap as infeasible when a leg is over it', () => {
    // The first live run's worst pool: a $10,000 buy into 7e-17 USD of reserves "completed".
    const dust = fixtureSnapshot({
      price: 0.19,
      spreads: [
        {
          notionalUsd: 1_000,
          spreadBps: 12.5,
          feasible: true,
          buyAvgPrice: 0.1901,
          sellAvgPrice: 0.1899,
        },
        {
          notionalUsd: 10_000,
          spreadBps: 1.449e24,
          feasible: true,
          buyAvgPrice: 3.2085956202697417e22,
          sellAvgPrice: 1.3547807691578489e-21,
        },
      ],
    })
    expect(snapshotSummaryFields(dust).spread10kBps).toBeNull()
    // a $10,000 spread whose legs are within 5,000 bps is kept
    const wide = fixtureSnapshot({
      price: 2_500,
      spreads: [
        {
          notionalUsd: 10_000,
          spreadBps: 6_902.55,
          feasible: true,
          buyAvgPrice: 3_507.52,
          sellAvgPrice: 1_781.88,
        },
      ],
    })
    expect(snapshotSummaryFields(wide).spread10kBps).toBe(6_902.55)
  })

  it("serves a legacy row, inserted before the cap, under today's rule on every read path", () => {
    const dust = fixtureSnapshot({
      poolId: A,
      price: 0.19,
      timestamp: 100,
      spreads: [
        {
          notionalUsd: 1_000,
          spreadBps: 12.5,
          feasible: true,
          buyAvgPrice: 0.1901,
          sellAvgPrice: 0.1899,
        },
        {
          notionalUsd: 10_000,
          spreadBps: 1.449e24,
          feasible: true,
          buyAvgPrice: 3.2085956202697417e22,
          sellAvgPrice: 1.3547807691578489e-21,
        },
      ],
    })
    // within the cap, but its denormalised column is stale: reads follow the stored point
    const wide = fixtureSnapshot({
      poolId: B,
      price: 2_500,
      timestamp: 100,
      spreads: [
        {
          notionalUsd: 10_000,
          spreadBps: 6_902.55,
          feasible: true,
          buyAvgPrice: 3_507.52,
          sellAvgPrice: 1_781.88,
        },
      ],
    })
    const noPoint = fixtureSnapshot({ poolId: 'uniswap-v3:0xc', timestamp: 100, spreads: [] })
    db.snapshots.insertMany([dust, wide, noPoint])
    // The row as the first live run wrote it: the uncapped 1e24 bps in the denormalised column.
    db.raw
      .prepare('UPDATE snapshots SET spread10k_bps = ? WHERE pool_id = ?')
      .run(1.449e24, dust.poolId)
    db.raw.prepare('UPDATE snapshots SET spread10k_bps = ? WHERE pool_id = ?').run(1, wide.poolId)
    const infeasible = {
      notionalUsd: 10_000,
      spreadBps: null,
      feasible: false,
      buyAvgPrice: null,
      sellAvgPrice: null,
    }

    const latest = db.snapshots.latestForPool(A)
    expect(latest?.spreads).toEqual([dust.spreads[0], infeasible])
    expect(db.snapshots.latestForPools([A, B]).get(A)?.spreads).toEqual([
      dust.spreads[0],
      infeasible,
    ])
    expect(db.snapshots.seriesForPool(A, 0)[0]?.spreads[1]).toEqual(infeasible)
    // the stored JSON is left alone; only the reading changes
    const stored = db.raw.prepare('SELECT spreads_json FROM snapshots WHERE pool_id = ?').get(A)
    expect(JSON.parse(String(stored?.spreads_json))[1].spreadBps).toBe(1.449e24)

    const summaries = db.snapshots.latestSummaryForPools([A, B, 'uniswap-v3:0xc'])
    expect(summaries.get(A)?.spread10kBps).toBeNull()
    expect(summaries.get(B)?.spread10kBps).toBe(6_902.55)
    expect(summaries.get('uniswap-v3:0xc')?.spread10kBps).toBeNull()
    // a point within the cap is returned as stored, to the last digit
    expect(db.snapshots.latestForPool(B)?.spreads).toEqual(wide.spreads)
  })

  it('lists the ±2 % sides exactly as stored: a null side stays null, never 0', () => {
    const oneSided = fixtureSnapshot({
      poolId: A,
      timestamp: 100,
      depthUsd: [
        { pct: 1, upUsd: 10, downUsd: null, totalUsd: 10 },
        { pct: 2, upUsd: 1234.5, downUsd: null, totalUsd: 1234.5 },
        { pct: 5, upUsd: 50, downUsd: null, totalUsd: 50 },
      ],
    })
    const noLevel = fixtureSnapshot({ poolId: B, timestamp: 100, depthUsd: [] })
    // An older row of A with both sides priced must not leak into A's newest summary.
    db.snapshots.insertMany([fixtureSnapshot({ poolId: A, timestamp: 50 }), oneSided, noLevel])

    const summaries = db.snapshots.latestSummaryForPools([A, B])
    expect(summaries.get(A)).toEqual(snapshotSummary(oneSided))
    expect(summaries.get(A)).toMatchObject({
      depth2Usd: 1234.5,
      depth2UpUsd: 1234.5,
      depth2DownUsd: null,
    })
    expect(summaries.get(B)).toMatchObject({ depth2UpUsd: null, depth2DownUsd: null })
    expect(snapshotDepthSides(oneSided)).toEqual({ depth2UpUsd: 1234.5, depth2DownUsd: null })
  })

  it('returns the latest snapshot per pool by timestamp, not insertion order', () => {
    expect(
      db.snapshots.insertMany([
        fixtureSnapshot({ poolId: A, timestamp: 300, price: 3 }),
        fixtureSnapshot({ poolId: A, timestamp: 100, price: 1 }),
        fixtureSnapshot({ poolId: B, timestamp: 50, price: 5 }),
        fixtureSnapshot({ poolId: A, timestamp: 200, price: 2 }),
        fixtureSnapshot({ poolId: B, timestamp: 60, price: 6 }),
      ]),
    ).toBe(5)
    expect(db.snapshots.insertMany([])).toBe(0)

    expect(db.snapshots.latestForPool(A)?.price).toBe(3)
    expect(db.snapshots.latestForPool(B)?.price).toBe(6)
    expect(db.snapshots.latestForPool('missing')).toBeUndefined()

    const latest = db.snapshots.latestForPools([A, B, 'missing'])
    expect([...latest.keys()].sort()).toEqual([A, B].sort())
    expect(latest.get(A)?.timestamp).toBe(300)
    expect(latest.get(B)?.timestamp).toBe(60)
    expect(db.snapshots.latestForPools([]).size).toBe(0)

    const summaries = db.snapshots.latestSummaryForPools([A, B])
    expect(summaries.get(A)?.price).toBe(3)
    expect(summaries.get(B)?.updatedAt).toBe(60)

    expect(db.snapshots.latestTimestamp()).toBe(300)
    expect(db.snapshots.countForPool(A)).toBe(3)
    expect(db.snapshots.countForPool(B)).toBe(2)
  })

  it('breaks timestamp ties by insertion order', () => {
    db.snapshots.insert(fixtureSnapshot({ poolId: A, timestamp: 100, price: 1, blockNumber: 1n }))
    db.snapshots.insert(fixtureSnapshot({ poolId: A, timestamp: 100, price: 2, blockNumber: 2n }))
    expect(db.snapshots.latestForPool(A)?.price).toBe(2)
    expect(db.snapshots.latestForPools([A]).get(A)?.price).toBe(2)
    expect(db.snapshots.latestBlock()).toBe(2n)
  })

  it('returns ascending, bounded series per pool', () => {
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: A, timestamp: 40 }),
      fixtureSnapshot({ poolId: A, timestamp: 10 }),
      fixtureSnapshot({ poolId: B, timestamp: 25 }),
      fixtureSnapshot({ poolId: A, timestamp: 30 }),
      fixtureSnapshot({ poolId: A, timestamp: 20 }),
    ])
    const ts = (list: { timestamp: number }[]) => list.map((s) => s.timestamp)
    expect(ts(db.snapshots.seriesForPool(A, 0))).toEqual([10, 20, 30, 40])
    expect(ts(db.snapshots.seriesForPool(A, 20))).toEqual([20, 30, 40])
    expect(ts(db.snapshots.seriesForPool(A, 20, 30))).toEqual([20, 30])
    expect(ts(db.snapshots.seriesForPool(A, 11, 19))).toEqual([])
    expect(ts(db.snapshots.seriesForPool(A, 41))).toEqual([])
    expect(ts(db.snapshots.seriesForPool(B, 0))).toEqual([25])
    expect(db.snapshots.seriesForPool(A, 0).every((s) => s.poolId === A)).toBe(true)
  })

  it('reports latest timestamp/block on an empty table and prunes old rows', () => {
    expect(db.snapshots.latestTimestamp()).toBeNull()
    expect(db.snapshots.latestBlock()).toBeNull()
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: A, timestamp: 10, blockNumber: 10n }),
      fixtureSnapshot({ poolId: A, timestamp: 20, blockNumber: FIXTURE_BIG }),
      fixtureSnapshot({ poolId: B, timestamp: 30, blockNumber: 30n }),
    ])
    expect(db.snapshots.latestBlock()).toBe(30n)
    expect(db.snapshots.pruneBefore(20)).toBe(1)
    expect(db.snapshots.pruneBefore(20)).toBe(0)
    expect(db.snapshots.count()).toBe(2)
    expect(db.snapshots.seriesForPool(A, 0).map((s) => s.timestamp)).toEqual([20])
    expect(db.snapshots.pruneBefore(100)).toBe(2)
    expect(db.snapshots.latestTimestamp()).toBeNull()
    // With a limit, the oldest rows go first and the count says when a batch loop is done.
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: A, timestamp: 10, blockNumber: 10n }),
      fixtureSnapshot({ poolId: B, timestamp: 20, blockNumber: 20n }),
      fixtureSnapshot({ poolId: A, timestamp: 30, blockNumber: 30n }),
    ])
    expect(db.snapshots.pruneBefore(100, 2)).toBe(2)
    expect(db.snapshots.seriesForPool(A, 0).map((s) => s.timestamp)).toEqual([30])
    expect(db.snapshots.pruneBefore(100, 2)).toBe(1)
    expect(db.snapshots.count()).toBe(0)
  })
})
