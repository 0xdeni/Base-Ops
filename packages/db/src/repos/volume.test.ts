import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_BIG, fixtureBucket } from '../fixtures.js'

const A = 'uniswap-v3:0x000000000000000000000000000000000000000a'
const B = 'aerodrome-v2:0x000000000000000000000000000000000000000b'
const H = 3600

describe('VolumeRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips buckets with bigint amounts and replaces on conflict', () => {
    const bucket = fixtureBucket({
      poolId: A,
      hourStart: 10 * H,
      volumeToken0: FIXTURE_BIG * 3n,
      volumeToken1: FIXTURE_BIG + 9n,
    })
    expect(db.volume.upsertBuckets([bucket])).toBe(1)
    expect(db.volume.get(A, 10 * H)).toEqual(bucket)
    expect(db.volume.get(A, 11 * H)).toBeUndefined()

    const replaced = { ...bucket, volumeToken0: 5n, volumeUsd: 1, swapCount: 1 }
    db.volume.upsertBuckets([replaced])
    expect(db.volume.get(A, 10 * H)).toEqual(replaced)
    expect(db.volume.count()).toBe(1)
    expect(db.volume.upsertBuckets([])).toBe(0)
  })

  it('sums USD over [fromTs, toTs) and distinguishes unknown from zero', () => {
    db.volume.upsertBuckets([
      fixtureBucket({ poolId: A, hourStart: 1 * H, volumeUsd: 100, swapCount: 1 }),
      fixtureBucket({ poolId: A, hourStart: 2 * H, volumeUsd: 200.5, swapCount: 2 }),
      fixtureBucket({ poolId: A, hourStart: 3 * H, volumeUsd: null, swapCount: 3 }),
      fixtureBucket({ poolId: A, hourStart: 4 * H, volumeUsd: 0, swapCount: 0 }),
      fixtureBucket({ poolId: B, hourStart: 2 * H, volumeUsd: 7, swapCount: 1 }),
      fixtureBucket({ poolId: B, hourStart: 3 * H, volumeUsd: null, swapCount: 1 }),
    ])
    expect(db.volume.sumUsd(A, 0)).toBe(300.5)
    expect(db.volume.sumUsd(A, 2 * H)).toBe(200.5)
    expect(db.volume.sumUsd(A, 1 * H, 2 * H)).toBe(100)
    expect(db.volume.sumUsd(A, 1 * H, 3 * H)).toBe(300.5)
    expect(db.volume.sumUsd(A, 4 * H)).toBe(0)
    expect(db.volume.sumUsd(A, 3 * H, 4 * H)).toBeNull()
    expect(db.volume.sumUsd(A, 99 * H)).toBeNull()
    expect(db.volume.sumUsd('missing', 0)).toBeNull()
    expect(db.volume.swapCount(A, 0)).toBe(6)
    expect(db.volume.swapCount(A, 2 * H, 4 * H)).toBe(5)
    expect(db.volume.swapCount('missing', 0)).toBe(0)

    const sums = db.volume.sumUsdForPools([A, B, 'missing'], 0)
    expect([...sums.entries()].sort()).toEqual([
      [B, 7],
      [A, 300.5],
    ])
    expect(db.volume.sumUsdForPools([B], 3 * H).size).toBe(0)
    expect(db.volume.sumUsdForPools([A, B], 2 * H, 3 * H)).toEqual(
      new Map([
        [A, 200.5],
        [B, 7],
      ]),
    )
    expect(db.volume.sumUsdForPools([], 0).size).toBe(0)
  })

  it('returns ascending series and prunes old buckets', () => {
    db.volume.upsertBuckets([
      fixtureBucket({ poolId: A, hourStart: 3 * H }),
      fixtureBucket({ poolId: A, hourStart: 1 * H }),
      fixtureBucket({ poolId: B, hourStart: 2 * H }),
      fixtureBucket({ poolId: A, hourStart: 2 * H }),
    ])
    const hours = (list: { hourStart: number }[]) => list.map((b) => b.hourStart / H)
    expect(hours(db.volume.series(A, 0))).toEqual([1, 2, 3])
    expect(hours(db.volume.series(A, 2 * H))).toEqual([2, 3])
    expect(hours(db.volume.series(A, 1 * H, 3 * H))).toEqual([1, 2])
    expect(db.volume.series(A, 0).every((b) => b.poolId === A)).toBe(true)
    expect(db.volume.pruneBefore(2 * H)).toBe(1)
    expect(db.volume.count()).toBe(3)
    expect(hours(db.volume.series(A, 0))).toEqual([2, 3])
  })
})
