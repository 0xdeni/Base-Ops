import { type TokenInfo, tokenLabel } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
  fixtureToken,
} from '../fixtures.js'

/** Aero's token: the same symbol as Aerodrome's (`FIXTURE_AERO`), another name and address. */
const AERO_NEW: TokenInfo = {
  address: '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee',
  symbol: 'AERO',
  name: 'Aero',
  decimals: 18,
}

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

  it('sharedSymbols indexes the tokens of scored pools only, in one query', () => {
    const oldPool = fixturePool({
      dex: 'aerodrome-v2',
      kind: 'constant-product',
      address: fixtureAddress(0xa1),
      token0: FIXTURE_AERO,
      token1: FIXTURE_USDC,
    })
    const newPool = fixturePool({
      dex: 'aero-v2',
      kind: 'constant-product',
      address: fixtureAddress(0xa2),
      token0: AERO_NEW,
      token1: FIXTURE_USDC,
    })
    db.pools.upsertMany([oldPool, newPool])
    expect(db.tokens.sharedSymbols().bySymbol.size).toBe(0)

    // Only the new AERO's pool is scored: the old one is outside the index, still told apart.
    db.scores.upsert(fixtureScore({ poolId: newPool.id }))
    let shared = db.tokens.sharedSymbols()
    expect([...(shared.bySymbol.get('aero') ?? [])]).toEqual([AERO_NEW.address])
    expect([...(shared.bySymbol.get('usdc') ?? [])]).toEqual([FIXTURE_USDC.address])
    expect(shared.bySymbol.has('weth')).toBe(false)
    expect(tokenLabel(AERO_NEW, shared)).toBe('AERO')
    expect(tokenLabel(FIXTURE_AERO, shared)).toBe('AERO (Aerodrome)')

    // Both scored: each AERO is named.
    db.scores.upsert(fixtureScore({ poolId: oldPool.id }))
    shared = db.tokens.sharedSymbols()
    expect([...(shared.bySymbol.get('aero') ?? [])].sort()).toEqual(
      [AERO_NEW.address, FIXTURE_AERO.address].sort(),
    )
    expect(tokenLabel(AERO_NEW, shared)).toBe('AERO (Aero)')
    expect(tokenLabel(FIXTURE_AERO, shared)).toBe('AERO (Aerodrome)')
    expect(tokenLabel(FIXTURE_USDC, shared)).toBe('USDC')
  })
})
