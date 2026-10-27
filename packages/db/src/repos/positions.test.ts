import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_BIG, fixtureAddress, fixturePosition } from '../fixtures.js'

const A = 'uniswap-v3:0x000000000000000000000000000000000000000a'
const B = 'uniswap-v4:0x000000000000000000000000000000000000000b'

describe('PositionsRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips positions (bigint liquidity and token ids, null token ids, lowercase owners)', () => {
    const positions = [
      fixturePosition({
        tokenId: FIXTURE_BIG,
        liquidity: FIXTURE_BIG * 5n,
        tickLower: 0,
        tickUpper: 10,
      }),
      fixturePosition({
        tokenId: null,
        owner: fixtureAddress(0xbeef).toUpperCase().replace('0X', '0x') as `0x${string}`,
        tickLower: -100,
        tickUpper: 100,
      }),
      fixturePosition({ tokenId: null, tickLower: -100, tickUpper: 100, liquidity: 1n }),
      fixturePosition({ tokenId: 2n, tickLower: -100, tickUpper: 50 }),
    ]
    expect(db.positions.replaceForPool(A, positions, { updatedBlock: FIXTURE_BIG })).toBe(4)
    const stored = db.positions.forPool(A)
    expect(stored).toEqual([
      { ...positions[3] },
      { ...positions[1], owner: fixtureAddress(0xbeef) },
      positions[2],
      positions[0],
    ])
    expect(stored[3]?.liquidity).toBe(FIXTURE_BIG * 5n)
    expect(stored[3]?.tokenId).toBe(FIXTURE_BIG)
    expect(db.positions.updatedBlock(A)).toBe(FIXTURE_BIG)
    expect(db.positions.countForPool(A)).toBe(4)
    expect(db.positions.forPool(B)).toEqual([])
    expect(db.positions.updatedBlock(B)).toBeNull()
  })

  it('replaces the whole set per pool without touching other pools', () => {
    db.positions.replaceForPool(A, [
      fixturePosition({ tokenId: 1n }),
      fixturePosition({ tokenId: 2n }),
    ])
    db.positions.replaceForPool(B, [fixturePosition({ tokenId: 1n })])
    expect(db.positions.replaceForPool(A, [fixturePosition({ tokenId: 3n })])).toBe(1)
    expect(db.positions.forPool(A).map((p) => p.tokenId)).toEqual([3n])
    expect(db.positions.forPool(B).map((p) => p.tokenId)).toEqual([1n])
    expect(db.positions.updatedBlock(A)).toBe(0n)
    expect(db.positions.replaceForPool(A, [])).toBe(0)
    expect(db.positions.forPool(A)).toEqual([])
    expect(db.positions.updatedBlock(A)).toBeNull()
    expect(db.positions.deleteForPool(B)).toBe(1)
    expect(db.positions.deleteForPool(B)).toBe(0)
  })

  it('keeps the last of duplicate token ids', () => {
    db.positions.replaceForPool(A, [
      fixturePosition({ tokenId: 9n, liquidity: 1n }),
      fixturePosition({ tokenId: 9n, liquidity: 2n }),
    ])
    expect(db.positions.forPool(A)).toEqual([fixturePosition({ tokenId: 9n, liquidity: 2n })])
  })
})
