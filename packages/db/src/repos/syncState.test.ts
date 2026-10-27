import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'

describe('SyncStateRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('gets, sets, overwrites and deletes keys', () => {
    expect(db.syncState.get('discover:uniswap-v3:lastBlock')).toBeUndefined()
    db.syncState.set('discover:uniswap-v3:lastBlock', '123')
    expect(db.syncState.get('discover:uniswap-v3:lastBlock')).toBe('123')
    db.syncState.set('discover:uniswap-v3:lastBlock', '456')
    expect(db.syncState.get('discover:uniswap-v3:lastBlock')).toBe('456')
    db.syncState.set('a', '')
    expect(db.syncState.entries()).toEqual([
      ['a', ''],
      ['discover:uniswap-v3:lastBlock', '456'],
    ])
    expect(db.syncState.delete('a')).toBe(true)
    expect(db.syncState.delete('a')).toBe(false)
    expect(db.syncState.entries()).toEqual([['discover:uniswap-v3:lastBlock', '456']])
  })

  it('lists the keys under a prefix, literally (no LIKE wildcards)', () => {
    db.syncState.set('volume:lastBlock', '1')
    db.syncState.set('volume:uniswap-v3:0xab:fromTs', '2')
    db.syncState.set('volume_x', '3')
    db.syncState.set('discover:uniswap-v3:lastBlock', '4')
    expect(db.syncState.keys('volume:')).toEqual([
      'volume:lastBlock',
      'volume:uniswap-v3:0xab:fromTs',
    ])
    expect(db.syncState.keys('volume_')).toEqual(['volume_x'])
    expect(db.syncState.keys('none:')).toEqual([])
  })

  it('round-trips bigints and rejects malformed values', () => {
    db.syncState.setBigInt('block', 2n ** 100n)
    expect(db.syncState.getBigInt('block')).toBe(2n ** 100n)
    expect(db.syncState.get('block')).toBe('1267650600228229401496703205376')
    expect(db.syncState.getBigInt('missing')).toBeUndefined()
    db.syncState.set('bad', '12abc')
    expect(() => db.syncState.getBigInt('bad')).toThrow(/not an integer/)
  })
})
