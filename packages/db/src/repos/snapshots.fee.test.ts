/**
 * The LP fee each snapshot's depth and spread used (`PoolSnapshot.feePips`, schema version 7): a
 * Slipstream pool's fee is read per block, so each snapshot keeps its own, on every read path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { fixtureSnapshot } from '../fixtures.js'

const A = 'aero-slipstream:0x000000000000000000000000000000000000000a'

describe('SnapshotsRepo: the fee of each snapshot', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('stores the fee each snapshot used, per block, and an unknown fee as null', () => {
    db.snapshots.insertMany(
      [2055, 465, null].map((feePips, i) =>
        fixtureSnapshot({ poolId: A, blockNumber: BigInt(10 + i), timestamp: 10 + i, feePips }),
      ),
    )
    expect(db.snapshots.seriesForPool(A, 0).map((s) => s.feePips)).toEqual([2055, 465, null])
    expect(db.snapshots.seriesSummaryForPool(A, 0, 100).map((s) => s.feePips)).toEqual([
      2055,
      465,
      null,
    ])
    expect(db.snapshots.latestForPool(A)?.feePips).toBeNull()
    expect(db.snapshots.latestForPools([A]).get(A)?.feePips).toBeNull()
  })
})
