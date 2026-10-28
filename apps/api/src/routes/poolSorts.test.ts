/**
 * The `spread` and `top` sorts of `/api/pools` and `/api/tokens/:address`: ordered by the server
 * over every matching pool (the values the rows list, nulls last in both directions), so a page
 * of them is the right page whatever the number of pools.
 */
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { PoolsResponse, TokenDetail } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

describe('GET /api/pools and /api/tokens/:address by spread and top LP share', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  async function get<T>(path: string): Promise<T> {
    const res = await app.request(path)
    expect(res.status, path).toBe(200)
    return (await res.json()) as T
  }
  const pools = async (query: string) =>
    (await get<PoolsResponse>(`/api/pools${query}`)).items.map((item) => ({
      id: item.pool.id,
      spread: item.spread10kBps,
      top: item.ownerTop1Share,
    }))

  it('sorts by the $10k spread, nulls last in both directions', async () => {
    const p = seed.pools
    const asc = await pools('?sort=spread&dir=asc')
    expect(asc.map((row) => row.id)).toEqual([
      p.wethUsdcV3.id,
      p.wethAeroSlip.id,
      p.aeroUsdcV2.id,
      p.aeroUsdcSlip.id,
      p.wethDegenV4.id,
      p.brettToshiV3.id,
    ])
    expect(asc.map((row) => row.spread)).toEqual([8, 15, 35, 95, 180, null])
    const desc = await pools('?sort=spread')
    expect(desc.map((row) => row.spread)).toEqual([180, 95, 35, 15, 8, null])
    // A page is cut from the server's order, not from a page sorted by health.
    const page = await pools('?sort=spread&dir=asc&rated=true&limit=2&offset=1')
    expect(page.map((row) => row.id)).toEqual([p.wethAeroSlip.id, p.aeroUsdcV2.id])
  })

  it('sorts by the top LP share, nulls last in both directions', async () => {
    const p = seed.pools
    const desc = await pools('?sort=top')
    expect(desc.map((row) => row.top)).toEqual([0.9, 0.8, 0.55, 0.32, null, null])
    expect(desc.slice(0, 2).map((row) => row.id)).toEqual([p.aeroUsdcSlip.id, p.brettToshiV3.id])
    const asc = await pools('?sort=top&dir=asc&limit=4')
    expect(asc.map((row) => row.top)).toEqual([0.32, 0.55, 0.8, 0.9])
  })

  it("sorts a token's pools by spread and top LP share", async () => {
    const p = seed.pools
    const weth = seed.tokens.WETH.address
    const bySpread = await get<TokenDetail>(`/api/tokens/${weth}?sort=spread&dir=asc`)
    expect(bySpread.pools.map((pool) => pool.pool.id)).toEqual([
      p.wethUsdcV3.id,
      p.wethAeroSlip.id,
      p.wethDegenV4.id,
    ])
    const byTop = await get<TokenDetail>(`/api/tokens/${weth}?sort=top&limit=1`)
    expect(byTop.pools.map((pool) => pool.pool.id)).toEqual([p.wethAeroSlip.id])
    expect(byTop.total).toBe(3)
  })

  it('still rejects an unknown sort key', async () => {
    for (const path of [
      '/api/pools?sort=spread10k',
      `/api/tokens/${seed.tokens.WETH.address}?sort=owner`,
    ]) {
      expect((await app.request(path)).status, path).toBe(400)
    }
  })
})
