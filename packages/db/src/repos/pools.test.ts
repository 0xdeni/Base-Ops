import type { PoolMeta } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureToken,
} from '../fixtures.js'

const DEGEN = fixtureToken({ address: fixtureAddress(0xdead), symbol: 'DEGEN', name: 'Degen' })

const V3 = fixturePool({ createdAtBlock: 2n ** 100n + 3n })
const V4: PoolMeta = fixturePool({
  dex: 'uniswap-v4',
  address: null,
  poolId: `0x${'ab'.repeat(32)}`,
  token0: DEGEN,
  token1: FIXTURE_WETH,
  feePips: 3000,
  tickSpacing: 60,
  hooks: fixtureAddress(0x4004),
})
const AERO_STABLE = fixturePool({
  dex: 'aerodrome-v2',
  kind: 'stable-swap',
  address: fixtureAddress(3),
  token0: FIXTURE_USDC,
  token1: FIXTURE_AERO,
  feePips: 500,
  tickSpacing: null,
  stable: true,
})
const SLIPSTREAM = fixturePool({
  dex: 'aerodrome-slipstream',
  address: fixtureAddress(4),
  token0: FIXTURE_WETH,
  token1: FIXTURE_AERO,
  tickSpacing: 100,
})

describe('PoolsRepo', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:', { now: () => 1_700_000_000 })
    db.pools.upsertMany([V3, V4, AERO_STABLE, SLIPSTREAM])
  })
  afterEach(() => db.close())

  it('round-trips every PoolMeta variant and writes the embedded tokens', () => {
    expect(db.pools.get(V3.id)).toEqual(V3)
    expect(db.pools.get(V4.id)).toEqual(V4)
    expect(db.pools.get(AERO_STABLE.id)).toEqual(AERO_STABLE)
    expect(db.pools.get(SLIPSTREAM.id)).toEqual(SLIPSTREAM)
    expect(db.pools.get('nope')).toBeUndefined()
    expect(db.pools.get(V3.id)?.createdAtBlock).toBe(2n ** 100n + 3n)
    expect(db.tokens.get(DEGEN.address)).toEqual(DEGEN)
    expect(db.tokens.count()).toBe(4)
    expect(db.pools.count()).toBe(4)
  })

  it('preserves tracked and first_seen_at on re-upsert but updates metadata', () => {
    db.pools.setTracked([V3.id], true)
    expect(db.pools.upsertMany([{ ...V3, feePips: 10_000 }])).toBe(1)
    const record = db.pools.getRecord(V3.id)
    expect(record?.pool.feePips).toBe(10_000)
    expect(record?.tracked).toBe(true)
    expect(record?.firstSeenAt).toBe(1_700_000_000)
    expect(db.pools.upsertMany([])).toBe(0)
  })

  it('lowercases addresses on write', () => {
    const upper = fixturePool({
      address: fixtureAddress(0xabc).toUpperCase().replace('0X', '0x') as `0x${string}`,
      id: 'uniswap-v3:mixed',
      token0: {
        ...FIXTURE_WETH,
        address: FIXTURE_WETH.address.toUpperCase().replace('0X', '0x') as `0x${string}`,
      },
    })
    db.pools.upsertMany([upper])
    const stored = db.pools.get('uniswap-v3:mixed')
    expect(stored?.address).toBe(fixtureAddress(0xabc))
    expect(stored?.token0.address).toBe(FIXTURE_WETH.address)
  })

  it('lists with dex, tracked and q filters', () => {
    expect(db.pools.list().map((p) => p.id)).toEqual(
      [V3, V4, AERO_STABLE, SLIPSTREAM].map((p) => p.id).sort(),
    )
    expect(db.pools.list({ dex: 'aerodrome-v2' }).map((p) => p.id)).toEqual([AERO_STABLE.id])
    expect(db.pools.count({ dex: 'uniswap-v3' })).toBe(1)

    db.pools.setTracked([V3.id, V4.id], true)
    expect(db.pools.list({ tracked: true }).map((p) => p.id)).toEqual([V3.id, V4.id])
    expect(db.pools.list({ tracked: false }).map((p) => p.id)).toEqual(
      [AERO_STABLE.id, SLIPSTREAM.id].sort(),
    )
    expect(db.pools.count({ tracked: true })).toBe(2)
    expect(db.pools.trackedIds()).toEqual([V3.id, V4.id])
    expect(db.pools.isTracked(V3.id)).toBe(true)
    expect(db.pools.isTracked(SLIPSTREAM.id)).toBe(false)
    expect(db.pools.isTracked('missing')).toBe(false)

    // symbol substring, case-insensitive
    expect(db.pools.list({ q: 'aero' }).map((p) => p.id)).toEqual(
      [AERO_STABLE.id, SLIPSTREAM.id].sort(),
    )
    expect(db.pools.list({ q: 'USDC' }).map((p) => p.id)).toEqual([V3.id, AERO_STABLE.id].sort())
    expect(db.pools.list({ q: 'usdc', dex: 'uniswap-v3' }).map((p) => p.id)).toEqual([V3.id])
    // token address (any case) and pool address / v4 pool id
    expect(db.pools.list({ q: DEGEN.address.toUpperCase() }).map((p) => p.id)).toEqual([V4.id])
    expect(db.pools.list({ q: fixtureAddress(3) }).map((p) => p.id)).toEqual([AERO_STABLE.id])
    expect(db.pools.list({ q: 'abababab' }).map((p) => p.id)).toEqual([V4.id])
    expect(db.pools.count({ q: 'weth' })).toBe(3)
    // LIKE metacharacters are literal, blank q is ignored
    expect(db.pools.list({ q: '%' })).toHaveLength(0)
    expect(db.pools.list({ q: '_' })).toHaveLength(0)
    expect(db.pools.list({ q: '  ' })).toHaveLength(4)
  })

  it('paginates deterministically', () => {
    const all = db.pools.list().map((p) => p.id)
    expect(db.pools.list({ limit: 2 }).map((p) => p.id)).toEqual(all.slice(0, 2))
    expect(db.pools.list({ limit: 2, offset: 2 }).map((p) => p.id)).toEqual(all.slice(2, 4))
    expect(db.pools.list({ limit: 2, offset: 10 })).toEqual([])
    expect(db.pools.list({ limit: 0 })).toEqual([])
    expect(() => db.pools.list({ limit: -5 })).toThrow(RangeError)
    expect(() => db.pools.list({ offset: 1.5 })).toThrow(RangeError)
  })

  it('setTracked reports changes and tolerates unknown ids', () => {
    expect(db.pools.setTracked([], true)).toBe(0)
    expect(db.pools.setTracked([V3.id, 'missing'], true)).toBe(1)
    expect(db.pools.setTracked([V3.id], true)).toBe(1)
    expect(db.pools.setTracked([V3.id, V4.id], false)).toBe(2)
    expect(db.pools.count({ tracked: true })).toBe(0)
  })

  it('finds pools by token on either side and fetches many by id', () => {
    expect(db.pools.forToken(FIXTURE_WETH.address).map((p) => p.id)).toEqual(
      [V3.id, V4.id, SLIPSTREAM.id].sort(),
    )
    expect(db.pools.forToken(FIXTURE_AERO.address.toUpperCase()).map((p) => p.id)).toEqual(
      [AERO_STABLE.id, SLIPSTREAM.id].sort(),
    )
    expect(db.pools.forToken(fixtureAddress(0x999))).toEqual([])

    const many = db.pools.getMany([V4.id, 'missing', V3.id])
    expect([...many.keys()].sort()).toEqual([V3.id, V4.id].sort())
    expect(many.get(V4.id)).toEqual(V4)
    expect(db.pools.getMany([]).size).toBe(0)
  })

  it('deletes', () => {
    expect(db.pools.delete(V3.id)).toBe(true)
    expect(db.pools.delete(V3.id)).toBe(false)
    expect(db.pools.count()).toBe(3)
  })
})
