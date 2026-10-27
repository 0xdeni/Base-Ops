import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { ErrorResponse, GapsResponse } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

describe('GET /api/gaps', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  async function gaps(query = ''): Promise<GapsResponse> {
    const res = await app.request(`/api/gaps${query}`)
    expect(res.status).toBe(200)
    return (await res.json()) as GapsResponse
  }

  it('ranks pools with volume >= $10k by gap score desc', async () => {
    const body = await gaps()
    expect(body.minVolumeUsd).toBe(10_000)
    expect(body.items.map((item) => item.pool.pool.id)).toEqual([
      seed.pools.wethDegenV4.id,
      seed.pools.aeroUsdcV2.id,
      seed.pools.aeroUsdcSlip.id, // volume exactly on the floor is included
      seed.pools.wethUsdcV3.id,
    ])
    const scores = body.items.map((item) => item.gap.gapScore ?? -1)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('excludes pools below the floor or with unknown volume / gap', async () => {
    const ids = (await gaps()).items.map((item) => item.pool.pool.id)
    expect(ids).not.toContain(seed.pools.wethAeroSlip.id) // $9 500
    expect(ids).not.toContain(seed.pools.brettToshiV3.id) // null
    expect(ids).not.toContain(seed.pools.usdcDegenV3.id) // unscored
  })

  it('pairs the pool summary with the full gap metrics', async () => {
    const top = (await gaps('?limit=1')).items[0]
    expect(top?.gap).toEqual({
      volume24hUsd: 300_000,
      depth2Usd: 12_000,
      turnoverRatio: 25,
      gapScore: expect.closeTo(69.897, 3),
    })
    expect(top?.pool).toMatchObject({
      health: { total: 41, grade: 'D' },
      gapScore: top?.gap.gapScore,
      depth2Usd: 12_000,
      volume24hUsd: 300_000,
      ownerTop1Share: null,
      spread10kBps: 180,
    })
    expect(top?.pool.pool.hooks).toBe('0x00000000000000000000000000000000000040c0')
  })

  it('pages and honours a custom floor', async () => {
    const page = await gaps('?limit=2&offset=1')
    expect(page.items.map((item) => item.pool.pool.id)).toEqual([
      seed.pools.aeroUsdcV2.id,
      seed.pools.aeroUsdcSlip.id,
    ])
    const low = await gaps('?minVolume=0')
    expect(low.minVolumeUsd).toBe(0)
    expect(low.items.map((item) => item.pool.pool.id)).toContain(seed.pools.wethAeroSlip.id)
    const high = await gaps('?minVolume=1000000')
    expect(high.items.map((item) => item.pool.pool.id)).toEqual([seed.pools.wethUsdcV3.id])
  })

  it('validates its parameters', async () => {
    for (const query of ['?limit=0', '?limit=500', '?offset=x', '?minVolume=-2']) {
      const res = await app.request(`/api/gaps${query}`)
      expect(res.status, query).toBe(400)
      expect(((await res.json()) as ErrorResponse).error).toMatch(/^invalid query: /)
    }
  })
})
