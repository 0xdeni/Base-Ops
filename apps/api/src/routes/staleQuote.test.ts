/**
 * Stale quotes on the API (docs/METRICS.md, "Stale quotes"): `PoolSummary.priceDeviationBps` and
 * `staleQuote` come from the newest snapshot, `GET /api/stats` leaves a stale quote's depth out of
 * its depth sums, a depth sort puts it after the other pools, and the responses still match the
 * documented schemas.
 */
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { PoolDetail, PoolsResponse, StatsResponse, TokenDetail } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

async function get<T>(app: Hono, path: string): Promise<T> {
  const res = await app.request(path)
  expect(res.status, path).toBe(200)
  return (await res.json()) as T
}

describe('a pool whose newest snapshot quotes a stale price', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  let staleId: string

  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
    // WETH/AERO Slipstream ($400,000 of ±2 % depth) now quotes AERO 10 % off its USD cross.
    staleId = seed.pools.wethAeroSlip.id
    const latest = db.snapshots.latestForPool(staleId)
    if (latest === undefined) throw new Error('seed has no snapshot for the pool')
    db.snapshots.insert({
      ...latest,
      timestamp: latest.timestamp + 1,
      price: latest.price * 1.1,
      priceDeviationBps: 1_000,
    })
  })
  afterEach(() => db.close())

  it('flags the pool in the lists and leaves the others as they were', async () => {
    const { items } = await get<PoolsResponse>(app, '/api/pools?limit=200')
    const stale = items.find((item) => item.pool.id === staleId)
    expect(stale).toMatchObject({ priceDeviationBps: 1_000, staleQuote: true, depth2Usd: 400_000 })
    for (const item of items.filter((i) => i.pool.id !== staleId)) {
      expect(item.staleQuote).toBe(false)
    }
    const detail = await get<PoolDetail>(app, `/api/pools/${staleId}`)
    expect(detail.latest?.priceDeviationBps).toBe(1_000)
  })

  it('leaves its depth out of the stats depth sums', async () => {
    const body = await get<StatsResponse>(app, '/api/stats')
    const slipstream = body.byDex.find((row) => row.dex === 'aerodrome-slipstream')
    // 402,000 before: the stale pool's 400,000 is no longer counted; the pool still is.
    expect(slipstream).toMatchObject({ scored: 2, depth2Usd: 2_000 })
    expect(body.totals.depth2Usd).toBe(1_000_000 + 12_000 + 150_000 + 2_000)
  })

  it('sorts it after the other pools on depth, in both directions', async () => {
    for (const dir of ['desc', 'asc']) {
      const { items } = await get<PoolsResponse>(app, `/api/pools?sort=depth&dir=${dir}&limit=200`)
      expect(items.at(-1)?.pool.id).toBe(staleId)
    }
    const weth = seed.tokens.WETH.address
    const token = await get<TokenDetail>(app, `/api/tokens/${weth}?limit=200`)
    expect(token.pools.at(-1)?.pool.id).toBe(staleId)
  })
})
