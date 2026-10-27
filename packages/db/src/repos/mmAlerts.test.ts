import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_BIG, fixtureMmAlert } from '../fixtures.js'

const M1 = 'acme-weth-usdc'
const M2 = 'acme-aero-usdc'

describe('MmAlertsRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips delivered and failed attempts', () => {
    const delivered = fixtureMmAlert({
      mandateId: M1,
      timestamp: 1_700_000_100,
      kind: 'breach',
      streakSamples: 4,
      payload: {
        event: 'breach',
        mandateId: M1,
        breaches: ['depthUp', 'spread'],
        attribution: { depthUpUsd: 1.5, spreadBps: null },
        nested: { list: [1, 'two', null] },
      },
      delivered: true,
      responseStatus: 204,
      error: null,
    })
    const failed = fixtureMmAlert({
      mandateId: M1,
      timestamp: 1_700_000_200,
      kind: 'recovered',
      streakSamples: 1,
      delivered: false,
      responseStatus: null,
      error: 'fetch failed: ECONNREFUSED',
    })
    expect(db.mmAlerts.insert(delivered)).toBe(1)
    expect(db.mmAlerts.insert(failed)).toBe(2)
    expect(db.mmAlerts.listFor(M1, 10)).toEqual([failed, delivered])
    expect(db.mmAlerts.latestFor(M1)).toEqual(failed)
    expect(db.mmAlerts.latestFor(M1)?.responseStatus).toBeNull()
    expect(db.mmAlerts.countFor(M1)).toBe(2)
    expect(db.mmAlerts.count()).toBe(2)
    const rejected = fixtureMmAlert({
      mandateId: M2,
      delivered: false,
      responseStatus: 500,
      error: 'HTTP 500',
    })
    db.mmAlerts.insert(rejected)
    expect(db.mmAlerts.latestFor(M2)).toEqual(rejected)
  })

  it('stores bigints inside the payload as decimal strings', () => {
    db.mmAlerts.insert(
      fixtureMmAlert({ mandateId: M1, payload: { blockNumber: FIXTURE_BIG, nested: [2n] } }),
    )
    expect(db.mmAlerts.latestFor(M1)?.payload).toEqual({
      blockNumber: FIXTURE_BIG.toString(),
      nested: ['2'],
    })
  })

  it('lists newest first by timestamp then insertion order, honouring the limit', () => {
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M1, timestamp: 30, streakSamples: 1 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M1, timestamp: 10, streakSamples: 2 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M2, timestamp: 40, streakSamples: 9 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M1, timestamp: 30, streakSamples: 3 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M1, timestamp: 20, streakSamples: 4 }))
    const streaks = (list: { streakSamples: number }[]) => list.map((a) => a.streakSamples)
    expect(streaks(db.mmAlerts.listFor(M1, 10))).toEqual([3, 1, 4, 2])
    expect(streaks(db.mmAlerts.listFor(M1, 2))).toEqual([3, 1])
    expect(streaks(db.mmAlerts.listFor(M1, 0))).toEqual([])
    expect(streaks(db.mmAlerts.listFor(M2, 5))).toEqual([9])
    expect(db.mmAlerts.listFor('missing', 5)).toEqual([])
    expect(db.mmAlerts.latestFor(M1)?.streakSamples).toBe(3)
    expect(db.mmAlerts.latestFor('missing')).toBeUndefined()
    expect(db.mmAlerts.listFor(M1, 10).every((a) => a.mandateId === M1)).toBe(true)
    expect(() => db.mmAlerts.listFor(M1, -1)).toThrow(RangeError)
  })

  it('finds the newest delivered alert and counts attempts of a kind after a timestamp', () => {
    const at = (timestamp: number, kind: 'breach' | 'recovered', delivered: boolean) =>
      db.mmAlerts.insert(
        fixtureMmAlert({
          mandateId: M1,
          timestamp,
          kind,
          delivered,
          responseStatus: delivered ? 200 : 503,
          error: delivered ? null : 'HTTP 503',
        }),
      )
    expect(db.mmAlerts.latestDeliveredFor(M1)).toBeUndefined()
    expect(db.mmAlerts.countAttempts(M1, 'breach')).toBe(0)
    at(10, 'breach', false)
    at(11, 'breach', true)
    at(12, 'recovered', false)
    at(13, 'recovered', false)
    at(14, 'breach', false)
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M2, timestamp: 99, delivered: true }))
    expect(db.mmAlerts.latestFor(M1)?.timestamp).toBe(14)
    expect(db.mmAlerts.latestDeliveredFor(M1)).toMatchObject({
      timestamp: 11,
      kind: 'breach',
      delivered: true,
    })
    expect(db.mmAlerts.countAttempts(M1, 'breach')).toBe(3)
    expect(db.mmAlerts.countAttempts(M1, 'breach', 10)).toBe(2)
    expect(db.mmAlerts.countAttempts(M1, 'breach', 14)).toBe(0)
    expect(db.mmAlerts.countAttempts(M1, 'recovered')).toBe(2)
    expect(db.mmAlerts.countAttempts(M1, 'recovered', 11)).toBe(2)
    expect(db.mmAlerts.countAttempts(M1, 'recovered', 13)).toBe(0)
    expect(db.mmAlerts.countAttempts('missing', 'breach')).toBe(0)
  })

  it('prunes by timestamp and deletes per mandate', () => {
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M1, timestamp: 10 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M1, timestamp: 20 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M2, timestamp: 15 }))
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: M2, timestamp: 25 }))
    expect(db.mmAlerts.pruneBefore(20)).toBe(2)
    expect(db.mmAlerts.pruneBefore(20)).toBe(0)
    expect(db.mmAlerts.latestFor(M1)?.timestamp).toBe(20)
    expect(db.mmAlerts.latestFor(M2)?.timestamp).toBe(25)
    expect(db.mmAlerts.deleteFor(M1)).toBe(1)
    expect(db.mmAlerts.deleteFor(M1)).toBe(0)
    expect(db.mmAlerts.countFor(M1)).toBe(0)
    expect(db.mmAlerts.count()).toBe(1)
  })
})
