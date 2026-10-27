/**
 * `PoolSummary.depth2UpUsd` / `depth2DownUsd`: the two sides of the newest snapshot's ±2 % level,
 * passed through as core stored them (never re-derived), null exactly when a side is unknown, and
 * the same on every route that returns a `PoolSummary`.
 */
import type { DepthLevelUsd, PoolSnapshot } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type {
  GapsResponse,
  PoolSummary,
  PoolsResponse,
  ScorecardDetail,
  ScorecardsResponse,
  TokenDetail,
} from '../dto.js'
import { resolvePointer, type Schema, validate } from '../testing/schema.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'
import { readAgentDoc } from './agentDocs.js'

const openapi = JSON.parse(readAgentDoc('openapi.json')) as unknown

async function get<T>(app: Hono, path: string): Promise<T> {
  const res = await app.request(path)
  expect(res.status, path).toBe(200)
  return (await res.json()) as T
}

const level2 = (snapshot: PoolSnapshot | undefined): DepthLevelUsd | undefined =>
  snapshot?.depthUsd.find((level) => level.pct === 2)

describe('PoolSummary per-side ±2 % depth', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  /** Stores a newer snapshot of `poolId`: the seed's newest with `depthUsd` swapped in. */
  function snapshotWith(poolId: string, depthUsd: DepthLevelUsd[]): void {
    const latest = seed.snapshots.get(poolId)?.at(-1)
    if (!latest) throw new Error(`seed has no snapshot of ${poolId}`)
    // Same timestamp as the seed's newest: the higher row id makes it the newest snapshot.
    db.snapshots.insert({ ...latest, depthUsd })
  }

  it('carries the newest snapshot ±2 % upUsd and downUsd of every scored pool', async () => {
    const { items } = await get<PoolsResponse>(app, '/api/pools?limit=200')
    expect(items).toHaveLength(6)
    for (const item of items) {
      const level = level2(seed.snapshots.get(item.pool.id)?.at(-1))
      expect(level, item.pool.id).toBeDefined()
      expect(item.depth2UpUsd, item.pool.id).toBe(level?.upUsd ?? null)
      expect(item.depth2DownUsd, item.pool.id).toBe(level?.downUsd ?? null)
    }
    const weth = items.find((item) => item.pool.id === seed.pools.wethUsdcV3.id)
    expect(weth).toMatchObject({
      depth2Usd: 1_000_000,
      depth2UpUsd: 500_000,
      depth2DownUsd: 500_000,
    })
  })

  it('is null on both sides of the unpriced pool, never 0', async () => {
    const body = await get<PoolsResponse>(app, '/api/pools?sort=health&dir=asc&rated=false&limit=1')
    const item = body.items[0] as PoolSummary
    expect(item.pool.id).toBe(seed.pools.brettToshiV3.id)
    expect(item).toMatchObject({ depth2Usd: null, depth2UpUsd: null, depth2DownUsd: null })
  })

  it('keeps a priced side and nulls an unpriced one on every PoolSummary route', async () => {
    const pool = seed.pools.aeroUsdcV2
    snapshotWith(pool.id, [
      { pct: 1, upUsd: 20_000, downUsd: null, totalUsd: 20_000 },
      { pct: 2, upUsd: 41_250.5, downUsd: null, totalUsd: 41_250.5 },
      { pct: 5, upUsd: 99_000, downUsd: null, totalUsd: 99_000 },
    ])
    const sides = { depth2UpUsd: 41_250.5, depth2DownUsd: null }

    const pools = await get<PoolsResponse>(app, `/api/pools?dex=${pool.dex}`)
    expect(pools.items.find((item) => item.pool.id === pool.id)).toMatchObject(sides)

    const gaps = await get<GapsResponse>(app, '/api/gaps?minVolume=0&limit=200')
    expect(gaps.items.find((item) => item.pool.pool.id === pool.id)?.pool).toMatchObject(sides)

    const token = await get<TokenDetail>(app, `/api/tokens/${pool.token0.address}`)
    expect(token.pools.find((item) => item.pool.id === pool.id)).toMatchObject(sides)

    const mandates = await get<ScorecardsResponse>(app, `/api/mm?pool=${pool.id}`)
    const mandate = mandates.items[0]?.mandate
    if (!mandate) throw new Error(`seed has no mandate on ${pool.id}`)
    const detail = await get<ScorecardDetail>(app, `/api/mm/${mandate.id}`)
    expect(detail.pool).toMatchObject(sides)

    // openapi.json documents the null side (undocumented or mistyped fields would fail here).
    const schema = resolvePointer(openapi, '#/components/schemas/PoolsResponse') as Schema
    expect(validate(openapi, schema, pools)).toEqual([])
  })

  it('is null on both sides when the newest snapshot has no ±2 % level', async () => {
    const pool = seed.pools.wethDegenV4
    snapshotWith(pool.id, [])
    const body = await get<PoolsResponse>(app, `/api/pools?dex=${pool.dex}`)
    expect(body.items.find((item) => item.pool.id === pool.id)).toMatchObject({
      depth2UpUsd: null,
      depth2DownUsd: null,
    })
  })
})
