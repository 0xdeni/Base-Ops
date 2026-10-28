import type { MmSample } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_BIG, FIXTURE_MM_BLOCK, fixtureAttribution, fixtureMmSample } from '../fixtures.js'

const M1 = 'acme-weth-usdc'
const M2 = 'acme-aero-usdc'
const POOL = 'uniswap-v3:0x000000000000000000000000000000000000000a'

const ts = (list: { timestamp: number }[]) => list.map((s) => s.timestamp)

/** A sample at block `timestamp` unless given one: a mandate has one sample per block. */
const sample = (overrides: Partial<MmSample> & { timestamp: number }): MmSample =>
  fixtureMmSample({ blockNumber: BigInt(overrides.timestamp), ...overrides })

describe('MmSamplesRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips a sample with a 2^40-scale block number and every attribution field', () => {
    const sample = fixtureMmSample({
      mandateId: M1,
      poolId: POOL,
      blockNumber: FIXTURE_MM_BLOCK * 3n + 5n,
      timestamp: 1_700_000_123,
      attribution: fixtureAttribution({
        method: 'lp-share',
        holdings: 1,
        shareOfPool: 0.5,
        depthUpUsd: 12_345.678,
        depthDownUsd: 0,
        spreadBps: null,
        poolSpreadBps: 3.75,
      }),
      withinKpi: false,
      breaches: ['depthDown', 'spread'],
    })
    expect(db.mmSamples.insert(sample)).toBe(1)
    const stored = db.mmSamples.latestFor(M1)
    expect(stored).toEqual(sample)
    expect(stored?.blockNumber).toBe(FIXTURE_MM_BLOCK * 3n + 5n)
    expect(typeof stored?.blockNumber).toBe('bigint')
    expect(stored?.attribution.spreadBps).toBeNull()
    expect(stored?.attribution.depthDownUsd).toBe(0)
    expect(db.mmSamples.countFor(M1)).toBe(1)
    expect(db.mmSamples.count()).toBe(1)
  })

  it('keeps block numbers beyond 2^64 and the three withinKpi states', () => {
    db.mmSamples.insertMany([
      sample({ mandateId: M1, timestamp: 1, blockNumber: FIXTURE_BIG, withinKpi: true }),
      sample({
        mandateId: M1,
        timestamp: 2,
        withinKpi: null,
        attribution: fixtureAttribution({ depthUpUsd: null, depthDownUsd: null }),
      }),
      sample({
        mandateId: M1,
        timestamp: 3,
        withinKpi: false,
        attribution: fixtureAttribution({ method: 'none', holdings: 0, shareOfPool: null }),
        breaches: ['noLiquidity', 'depthUp', 'depthDown'],
      }),
    ])
    const series = db.mmSamples.seriesFor(M1, 0)
    expect(series.map((s) => s.withinKpi)).toEqual([true, null, false])
    expect(series[0]?.blockNumber).toBe(FIXTURE_BIG)
    expect(series[1]?.attribution.depthUpUsd).toBeNull()
    expect(series[2]?.breaches).toEqual(['noLiquidity', 'depthUp', 'depthDown'])
    expect(series[2]?.attribution.method).toBe('none')
  })

  it('returns ascending, bounded series per mandate', () => {
    expect(
      db.mmSamples.insertMany([
        sample({ mandateId: M1, timestamp: 40 }),
        sample({ mandateId: M1, timestamp: 10 }),
        sample({ mandateId: M2, timestamp: 25 }),
        sample({ mandateId: M1, timestamp: 30 }),
        sample({ mandateId: M1, timestamp: 20 }),
      ]),
    ).toBe(5)
    expect(db.mmSamples.insertMany([])).toBe(0)
    expect(ts(db.mmSamples.seriesFor(M1, 0))).toEqual([10, 20, 30, 40])
    expect(ts(db.mmSamples.seriesFor(M1, 20))).toEqual([20, 30, 40])
    expect(ts(db.mmSamples.seriesFor(M1, 20, 30))).toEqual([20, 30])
    expect(ts(db.mmSamples.seriesFor(M1, 11, 19))).toEqual([])
    expect(ts(db.mmSamples.seriesFor(M1, 41))).toEqual([])
    expect(ts(db.mmSamples.seriesFor(M2, 0))).toEqual([25])
    expect(ts(db.mmSamples.seriesFor('missing', 0))).toEqual([])
    expect(db.mmSamples.seriesFor(M1, 0).every((s) => s.mandateId === M1)).toBe(true)
    expect(db.mmSamples.countFor(M1)).toBe(4)
    expect(db.mmSamples.countFor(M2)).toBe(1)
    expect(db.mmSamples.countFor('missing')).toBe(0)
  })

  it('breaks timestamp ties by insertion order in series and latest', () => {
    db.mmSamples.insert(sample({ mandateId: M1, timestamp: 100, blockNumber: 1n }))
    db.mmSamples.insert(sample({ mandateId: M1, timestamp: 100, blockNumber: 2n }))
    db.mmSamples.insert(sample({ mandateId: M1, timestamp: 50, blockNumber: 3n }))
    expect(db.mmSamples.seriesFor(M1, 0).map((s) => s.blockNumber)).toEqual([3n, 1n, 2n])
    expect(db.mmSamples.latestFor(M1)?.blockNumber).toBe(2n)
    expect(db.mmSamples.latestForMany([M1]).get(M1)?.blockNumber).toBe(2n)
  })

  it('reports the newest sample id per mandate as an index lookup', () => {
    expect(db.mmSamples.latestIdFor(M1)).toBeNull()
    const first = db.mmSamples.insert(sample({ mandateId: M1, timestamp: 300 }))
    expect(db.mmSamples.latestIdFor(M1)).toBe(first)
    // an older sample inserted later does not become the newest
    db.mmSamples.insert(sample({ mandateId: M1, timestamp: 100 }))
    expect(db.mmSamples.latestIdFor(M1)).toBe(first)
    // a tie on the timestamp goes to the later insertion
    const tie = db.mmSamples.insert(sample({ mandateId: M1, timestamp: 300, blockNumber: 301n }))
    expect(db.mmSamples.latestIdFor(M1)).toBe(tie)
    expect(db.mmSamples.latestIdFor(M2)).toBeNull()
    db.mmSamples.deleteFor(M1)
    expect(db.mmSamples.latestIdFor(M1)).toBeNull()
  })

  it('returns the latest sample per mandate by timestamp, not insertion order', () => {
    db.mmSamples.insertMany([
      sample({ mandateId: M1, timestamp: 300, withinKpi: false, breaches: ['depthUp'] }),
      sample({ mandateId: M1, timestamp: 100 }),
      sample({ mandateId: M2, timestamp: 50 }),
      sample({ mandateId: M1, timestamp: 200 }),
      sample({ mandateId: M2, timestamp: 60, withinKpi: null }),
    ])
    expect(db.mmSamples.latestFor(M1)?.timestamp).toBe(300)
    expect(db.mmSamples.latestFor(M1)?.breaches).toEqual(['depthUp'])
    expect(db.mmSamples.latestFor(M2)?.timestamp).toBe(60)
    expect(db.mmSamples.latestFor('missing')).toBeUndefined()

    const latest = db.mmSamples.latestForMany([M1, M2, 'missing'])
    expect([...latest.keys()].sort()).toEqual([M1, M2].sort())
    expect(latest.get(M1)?.timestamp).toBe(300)
    expect(latest.get(M1)?.withinKpi).toBe(false)
    expect(latest.get(M2)?.timestamp).toBe(60)
    expect(latest.get(M2)?.withinKpi).toBeNull()
    expect(db.mmSamples.latestForMany([]).size).toBe(0)
    expect(db.mmSamples.latestForMany(['missing']).size).toBe(0)
  })

  it('returns the newest N samples oldest first with recentFor', () => {
    db.mmSamples.insertMany([
      sample({ mandateId: M1, timestamp: 40 }),
      sample({ mandateId: M1, timestamp: 10 }),
      sample({ mandateId: M2, timestamp: 35 }),
      sample({ mandateId: M1, timestamp: 30 }),
      sample({ mandateId: M1, timestamp: 20 }),
    ])
    expect(ts(db.mmSamples.recentFor(M1, 2))).toEqual([30, 40])
    expect(ts(db.mmSamples.recentFor(M1, 10))).toEqual([10, 20, 30, 40])
    expect(ts(db.mmSamples.recentFor(M1, 0))).toEqual([])
    expect(ts(db.mmSamples.recentFor(M2, 3))).toEqual([35])
    expect(ts(db.mmSamples.recentFor('missing', 3))).toEqual([])
    expect(() => db.mmSamples.recentFor(M1, -1)).toThrow(RangeError)
    expect(() => db.mmSamples.recentFor(M1, 1.5)).toThrow(RangeError)
  })

  it('prunes by timestamp across mandates and deletes per mandate', () => {
    db.mmSamples.insertMany([
      sample({ mandateId: M1, timestamp: 10 }),
      sample({ mandateId: M1, timestamp: 20 }),
      sample({ mandateId: M2, timestamp: 15 }),
      sample({ mandateId: M2, timestamp: 30 }),
    ])
    expect(db.mmSamples.pruneBefore(20)).toBe(2)
    expect(db.mmSamples.pruneBefore(20)).toBe(0)
    expect(ts(db.mmSamples.seriesFor(M1, 0))).toEqual([20])
    expect(ts(db.mmSamples.seriesFor(M2, 0))).toEqual([30])
    expect(db.mmSamples.count()).toBe(2)
    expect(db.mmSamples.deleteFor(M2)).toBe(1)
    expect(db.mmSamples.deleteFor(M2)).toBe(0)
    expect(db.mmSamples.latestFor(M2)).toBeUndefined()
    expect(db.mmSamples.pruneBefore(100)).toBe(1)
    expect(db.mmSamples.count()).toBe(0)
  })

  it('keeps one sample per mandate and block: a copy is skipped, another mandate shares it', () => {
    expect(db.mmSamples.insert(sample({ mandateId: M1, timestamp: 7 }))).toEqual(expect.any(Number))
    expect(db.mmSamples.insert(sample({ mandateId: M1, timestamp: 8, blockNumber: 7n }))).toBeNull()
    expect(db.mmSamples.insert(sample({ mandateId: M2, timestamp: 7 }))).toEqual(expect.any(Number))
    expect(
      db.mmSamples.insertMany([
        sample({ mandateId: M1, timestamp: 7, withinKpi: false }),
        sample({ mandateId: M1, timestamp: 9 }),
      ]),
    ).toBe(1)
    expect(db.mmSamples.seriesFor(M1, 0).map((s) => [s.blockNumber, s.timestamp])).toEqual([
      [7n, 7],
      [9n, 9],
    ])
    expect(db.mmSamples.latestFor(M1)?.withinKpi).toBe(true)
  })

  it('joins the snapshot transaction and rolls back with it', () => {
    expect(() =>
      db.transaction(() => {
        db.mmSamples.insert(sample({ mandateId: M1, timestamp: 1 }))
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(db.mmSamples.count()).toBe(0)
    db.transaction(() => {
      db.mmSamples.insertMany([sample({ mandateId: M1, timestamp: 1 })])
    })
    expect(db.mmSamples.count()).toBe(1)
  })
})
