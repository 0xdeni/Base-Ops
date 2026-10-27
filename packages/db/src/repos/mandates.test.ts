import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { FIXTURE_MM_OWNER, fixtureAddress, fixtureMandate } from '../fixtures.js'

const POOL_A = 'uniswap-v3:0x000000000000000000000000000000000000000a'
const POOL_B = 'aerodrome-v2:0x000000000000000000000000000000000000000b'
const POOL_C = 'aerodrome-slipstream:0x000000000000000000000000000000000000000c'

describe('MandatesRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('round-trips every column, lowercasing addresses', () => {
    const upper = fixtureAddress(0xabcdef).toUpperCase().replace('0X', '0x') as `0x${string}`
    const mandate = fixtureMandate({
      id: 'acme-weth-usdc',
      name: 'Acme WETH/USDC',
      poolId: POOL_A,
      marketMaker: 'Acme Markets',
      addresses: [FIXTURE_MM_OWNER, upper],
      kpis: {
        minDepthUsd: 123_456.5,
        bandPct: 1.5,
        maxSpreadBps: 25,
        spreadNotionalUsd: 25_000,
        targetUptime: 0.99,
      },
      alertWebhookUrl: 'https://hooks.example.com/depthwatch?x=1',
      alertAfterSamples: 5,
      active: false,
      createdAt: 1_699_999_999,
      notes: 'signed 2024-01-01',
    })
    db.mandates.upsert(mandate)
    expect(db.mandates.get('acme-weth-usdc')).toEqual({
      ...mandate,
      addresses: [FIXTURE_MM_OWNER, fixtureAddress(0xabcdef)],
    })
    expect(db.mandates.get('missing')).toBeUndefined()
    expect(db.mandates.count()).toBe(1)
  })

  it('stores nulls and defaults as given', () => {
    const mandate = fixtureMandate({ id: 'plain', poolId: POOL_A })
    db.mandates.upsert(mandate)
    const stored = db.mandates.get('plain')
    expect(stored).toEqual(mandate)
    expect(stored?.alertWebhookUrl).toBeNull()
    expect(stored?.notes).toBeNull()
    expect(stored?.kpis.maxSpreadBps).toBeNull()
    expect(stored?.active).toBe(true)
    expect(stored?.alertAfterSamples).toBe(3)
  })

  it('overwrites on upsert and counts upsertMany', () => {
    db.mandates.upsert(fixtureMandate({ id: 'm1', poolId: POOL_A, name: 'first' }))
    db.mandates.upsert(
      fixtureMandate({ id: 'm1', poolId: POOL_B, name: 'second', active: false, notes: 'moved' }),
    )
    expect(db.mandates.get('m1')).toMatchObject({
      poolId: POOL_B,
      name: 'second',
      active: false,
      notes: 'moved',
    })
    expect(db.mandates.count()).toBe(1)
    expect(db.mandates.upsertMany([])).toBe(0)
    expect(
      db.mandates.upsertMany([
        fixtureMandate({ id: 'm2', poolId: POOL_A }),
        fixtureMandate({ id: 'm3', poolId: POOL_A }),
      ]),
    ).toBe(2)
    expect(db.mandates.count()).toBe(3)
  })

  it('lists by id with active / poolId filters', () => {
    db.mandates.upsertMany([
      fixtureMandate({ id: 'zed', poolId: POOL_A, active: true }),
      fixtureMandate({ id: 'alpha', poolId: POOL_A, active: false }),
      fixtureMandate({ id: 'mid', poolId: POOL_B, active: true }),
    ])
    const ids = (list: { id: string }[]) => list.map((m) => m.id)
    expect(ids(db.mandates.list())).toEqual(['alpha', 'mid', 'zed'])
    expect(ids(db.mandates.list({ active: true }))).toEqual(['mid', 'zed'])
    expect(ids(db.mandates.list({ active: false }))).toEqual(['alpha'])
    expect(ids(db.mandates.list({ poolId: POOL_A }))).toEqual(['alpha', 'zed'])
    expect(ids(db.mandates.list({ poolId: POOL_A, active: true }))).toEqual(['zed'])
    expect(ids(db.mandates.list({ poolId: POOL_C }))).toEqual([])
    expect(db.mandates.count({ active: true })).toBe(2)
    expect(db.mandates.count({ poolId: POOL_B })).toBe(1)
  })

  it('groups mandates by pool with forPools', () => {
    db.mandates.upsertMany([
      fixtureMandate({ id: 'b-only', poolId: POOL_B }),
      fixtureMandate({ id: 'a-two', poolId: POOL_A, active: false }),
      fixtureMandate({ id: 'a-one', poolId: POOL_A }),
      fixtureMandate({ id: 'c-only', poolId: POOL_C }),
    ])
    const byPool = db.mandates.forPools([POOL_A, POOL_B, 'missing'])
    expect([...byPool.keys()].sort()).toEqual([POOL_A, POOL_B].sort())
    expect(byPool.get(POOL_A)?.map((m) => m.id)).toEqual(['a-one', 'a-two'])
    expect(byPool.get(POOL_B)?.map((m) => m.id)).toEqual(['b-only'])
    expect(byPool.get(POOL_A)?.[0]).toEqual(db.mandates.get('a-one'))
    expect(byPool.has(POOL_C)).toBe(false)
    expect(db.mandates.forPools([]).size).toBe(0)
    expect(db.mandates.forPools(['missing']).size).toBe(0)
  })

  it('toggles active and deletes', () => {
    db.mandates.upsert(fixtureMandate({ id: 'm1', poolId: POOL_A }))
    expect(db.mandates.setActive('m1', false)).toBe(true)
    expect(db.mandates.get('m1')?.active).toBe(false)
    expect(db.mandates.list({ active: true })).toEqual([])
    expect(db.mandates.setActive('m1', true)).toBe(true)
    expect(db.mandates.get('m1')?.active).toBe(true)
    expect(db.mandates.setActive('missing', true)).toBe(false)
    expect(db.mandates.delete('m1')).toBe(true)
    expect(db.mandates.delete('m1')).toBe(false)
    expect(db.mandates.get('m1')).toBeUndefined()
    expect(db.mandates.count()).toBe(0)
  })
})
