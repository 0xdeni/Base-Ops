import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { ErrorResponse, TokenDetail } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

describe('GET /api/tokens/:address', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  async function token(address: string, query = ''): Promise<TokenDetail> {
    const res = await app.request(`/api/tokens/${address}${query}`)
    expect(res.status).toBe(200)
    return (await res.json()) as TokenDetail
  }

  it('returns token info, USD price and the pools containing it', async () => {
    const body = await token(seed.tokens.WETH.address)
    expect(body.token).toEqual(seed.tokens.WETH)
    expect(body.usd).toBe(3000.25)
    expect(body.via).toEqual([seed.pools.wethUsdcV3.id])
    expect(body.priceUpdatedAt).toBe(seed.now)
    expect(body.pools.map((p) => p.pool.id)).toEqual([
      seed.pools.wethUsdcV3.id,
      seed.pools.wethAeroSlip.id,
      seed.pools.wethDegenV4.id,
    ])
    expect(body.total).toBe(3)
    expect(body.poolCount).toBe(3)
    expect(body.pools[0]).toMatchObject({ depth2Usd: 1_000_000, health: { total: 85, grade: 'A' } })
  })

  it('lowercases the address parameter', async () => {
    const mixed = '0x4200000000000000000000000000000000000006'.replace('0x4', '0X4').toUpperCase()
    const body = await token(mixed)
    expect(body.token.address).toBe(seed.tokens.WETH.address)
  })

  it('counts discovered pools separately from scored ones', async () => {
    const body = await token(seed.tokens.USDC.address)
    expect(body.usd).toBe(1)
    expect(body.via).toEqual([])
    expect(body.total).toBe(3)
    expect(body.poolCount).toBe(4) // + the discovered-only DEGEN/USDC pool
    expect(body.pools.map((p) => p.pool.id)).not.toContain(seed.pools.usdcDegenV3.id)
  })

  it('matches the address against token0/token1 only, never a symbol that spells it', async () => {
    const before = await token(seed.tokens.WETH.address)
    // A token whose symbol is WETH's address, in a scored pool without WETH.
    db.tokens.upsertMany([{ ...seed.tokens.USDC, symbol: seed.tokens.WETH.address }])
    const after = await token(seed.tokens.WETH.address, '?limit=200')
    expect(after.total).toBe(before.total)
    expect(after.poolCount).toBe(before.poolCount)
    expect(after.pools.map((p) => p.pool.id)).toEqual(before.pools.map((p) => p.pool.id))
    expect(after.pools.map((p) => p.pool.id)).not.toContain(seed.pools.aeroUsdcV2.id)
    // The search box still finds it by that symbol.
    const search = await app.request(`/api/pools?q=${seed.tokens.WETH.address}`)
    const found = (await search.json()) as { total: number }
    expect(found.total).toBeGreaterThan(before.total)
  })

  it('reports unpriced tokens with null usd', async () => {
    const body = await token(seed.tokens.BRETT.address)
    expect(body.usd).toBeNull()
    expect(body.via).toEqual([])
    expect(body.priceUpdatedAt).toBeNull()
    expect(body.pools.map((p) => p.pool.id)).toEqual([seed.pools.brettToshiV3.id])
    expect(body.pools[0]?.depth2Usd).toBeNull()
  })

  it('sorts and pages the pool list', async () => {
    const byHealthAsc = await token(seed.tokens.WETH.address, '?sort=health&dir=asc&limit=2')
    expect(byHealthAsc.pools.map((p) => p.pool.id)).toEqual([
      seed.pools.wethDegenV4.id,
      seed.pools.wethAeroSlip.id,
    ])
    expect(byHealthAsc.total).toBe(3)
    const offset = await token(seed.tokens.WETH.address, '?offset=2')
    expect(offset.pools.map((p) => p.pool.id)).toEqual([seed.pools.wethDegenV4.id])
  })

  it('404s for unknown tokens and 400s for malformed addresses', async () => {
    const unknown = await app.request('/api/tokens/0x00000000000000000000000000000000000000aa')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'token not found' })
    for (const bad of ['0x123', 'weth', '4200000000000000000000000000000000000006']) {
      const res = await app.request(`/api/tokens/${bad}`)
      expect(res.status, bad).toBe(400)
      expect(((await res.json()) as ErrorResponse).error).toContain('invalid token address')
    }
    const badQuery = await app.request(`/api/tokens/${seed.tokens.WETH.address}?limit=0`)
    expect(badQuery.status).toBe(400)
  })
})
