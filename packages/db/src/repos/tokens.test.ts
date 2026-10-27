import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_AERO, FIXTURE_USDC, FIXTURE_WETH, fixtureToken } from '../fixtures.js'

describe('TokensRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('upserts, reads back and overwrites by lowercase address', () => {
    expect(db.tokens.upsertMany([])).toBe(0)
    expect(db.tokens.upsertMany([FIXTURE_WETH, FIXTURE_USDC])).toBe(2)
    expect(db.tokens.get(FIXTURE_WETH.address)).toEqual(FIXTURE_WETH)
    expect(db.tokens.get(FIXTURE_WETH.address.toUpperCase().replace('0X', '0x'))).toEqual(
      FIXTURE_WETH,
    )
    expect(db.tokens.get('0x0000000000000000000000000000000000000001')).toBeUndefined()

    const renamed = fixtureToken({ symbol: 'WETH9', name: 'Wrapped Ether 9', decimals: 9 })
    db.tokens.upsertMany([{ ...renamed, address: renamed.address.toUpperCase() as `0x${string}` }])
    expect(db.tokens.get(FIXTURE_WETH.address)).toEqual(renamed)
    expect(db.tokens.count()).toBe(2)
  })

  it('getMany returns only known tokens, keyed by address, in one query', () => {
    db.tokens.upsertMany([FIXTURE_WETH, FIXTURE_USDC, FIXTURE_AERO])
    const found = db.tokens.getMany([
      FIXTURE_USDC.address,
      '0x00000000000000000000000000000000000000ff',
      FIXTURE_WETH.address.toUpperCase().replace('0X', '0x'),
    ])
    expect([...found.keys()].sort()).toEqual([FIXTURE_WETH.address, FIXTURE_USDC.address].sort())
    expect(found.get(FIXTURE_USDC.address)).toEqual(FIXTURE_USDC)
    expect(db.tokens.getMany([]).size).toBe(0)
    expect(db.tokens.all().map((t) => t.symbol)).toEqual(['WETH', 'USDC', 'AERO'])
  })
})
