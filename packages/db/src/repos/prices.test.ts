import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_AERO, FIXTURE_USDC, FIXTURE_WETH } from '../fixtures.js'

describe('PricesRepo', () => {
  let db: Database
  let now = 1_700_000_000
  beforeEach(() => {
    now = 1_700_000_000
    db = openDatabase(':memory:', { now: () => now })
  })
  afterEach(() => db.close())

  it('upserts, reads and lists prices with their routes', () => {
    expect(
      db.prices.upsertMany([
        { token: FIXTURE_USDC.address, usd: 1, via: [] },
        { token: FIXTURE_WETH.address, usd: 3000.5, via: ['uniswap-v3:0xpool'] },
      ]),
    ).toBe(2)
    expect(db.prices.get(FIXTURE_WETH.address)).toEqual({
      token: FIXTURE_WETH.address,
      usd: 3000.5,
      via: ['uniswap-v3:0xpool'],
      updatedAt: 1_700_000_000,
    })
    expect(db.prices.get(FIXTURE_WETH.address.toUpperCase().replace('0X', '0x'))?.usd).toBe(3000.5)
    expect(db.prices.usd(FIXTURE_USDC.address)).toBe(1)
    expect(db.prices.usd(FIXTURE_AERO.address)).toBeNull()
    expect(db.prices.get(FIXTURE_AERO.address)).toBeUndefined()
    expect([...db.prices.all().keys()]).toEqual([FIXTURE_WETH.address, FIXTURE_USDC.address])
    expect(db.prices.count()).toBe(2)

    now = 1_700_000_600
    db.prices.upsertMany([{ token: FIXTURE_WETH.address, usd: 2900, via: ['a', 'b'] }])
    expect(db.prices.get(FIXTURE_WETH.address)).toEqual({
      token: FIXTURE_WETH.address,
      usd: 2900,
      via: ['a', 'b'],
      updatedAt: 1_700_000_600,
    })
    db.prices.upsertMany([{ token: FIXTURE_AERO.address, usd: 1.25, via: ['x'] }], 42)
    expect(db.prices.get(FIXTURE_AERO.address)?.updatedAt).toBe(42)
    expect(db.prices.upsertMany([])).toBe(0)
  })

  it('replaceAll drops stale entries', () => {
    db.prices.upsertMany([
      { token: FIXTURE_USDC.address, usd: 1, via: [] },
      { token: FIXTURE_WETH.address, usd: 3000, via: [] },
    ])
    expect(db.prices.replaceAll([{ token: FIXTURE_AERO.address, usd: 1.5, via: [] }])).toBe(1)
    expect([...db.prices.all().keys()]).toEqual([FIXTURE_AERO.address])
    expect(db.prices.replaceAll([])).toBe(0)
    expect(db.prices.count()).toBe(0)
  })
})
