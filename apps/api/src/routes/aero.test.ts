/**
 * The Aero venues on every route: their DEX ids in the filter and the stats, the per-snapshot fee
 * in the history, and the token `label` that tells Aerodrome's AERO from Aero's on every token
 * object a response carries (DESIGN.md "API (apps/api)").
 */
import { DEXES } from '@depthwatch/core'
import { type Database, fixtureAddress, fixturePool, openDatabase } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type {
  GapsResponse,
  HistoryResponse,
  PoolDetail,
  PoolSummary,
  PoolsResponse,
  ScorecardDetail,
  StatsResponse,
  TokenDetail,
  TokenDto,
} from '../dto.js'
import { type AeroSeed, SEED_AERO_NEW, seedAeroTokens } from '../testing/aero.js'
import { createSeededDatabase, SEED_MM_BREACHED_ID, type Seed } from '../testing/seed.js'

describe('Aero venues and token labels', () => {
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

  /** Every token of a summary list, by address: one label per address. */
  function labelsOf(items: readonly PoolSummary[]): Map<string, string> {
    const out = new Map<string, string>()
    for (const { pool } of items)
      for (const token of [pool.token0, pool.token1]) out.set(token.address, token.label)
    return out
  }

  it('labels every token by its symbol while no other scored address shares it', async () => {
    const { items } = await get<PoolsResponse>('/api/pools?limit=200')
    for (const { pool } of items) {
      expect(pool.token0.label).toBe(pool.token0.symbol)
      expect(pool.token1.label).toBe(pool.token1.symbol)
    }
    const detail = await get<TokenDetail>(`/api/tokens/${seed.tokens.AERO.address}`)
    expect(detail.token).toEqual({ ...seed.tokens.AERO, label: 'AERO' })
  })

  describe('with both AEROs in scored pools', () => {
    let aero: AeroSeed
    beforeEach(() => {
      aero = seedAeroTokens(db, seed)
    })

    const OLD = 'AERO (Aerodrome)'
    const NEW = 'AERO (Aero)'

    it('names each AERO on the pools list, a pool, a token, the gaps feed and a scorecard', async () => {
      const list = await get<PoolsResponse>('/api/pools?limit=200')
      const labels = labelsOf(list.items)
      expect(labels.get(seed.tokens.AERO.address)).toBe(OLD)
      expect(labels.get(SEED_AERO_NEW.address)).toBe(NEW)
      expect(labels.get(seed.tokens.WETH.address)).toBe('WETH')
      expect(labels.get(seed.tokens.USDC.address)).toBe('USDC')

      const pool = await get<PoolDetail>(`/api/pools/${aero.aeroUsdcAeroV2.id}`)
      expect(pool.pool.token0).toEqual({ ...SEED_AERO_NEW, label: NEW })
      expect(pool.pool.token1.label).toBe('USDC')

      const token = await get<TokenDetail>(`/api/tokens/${seed.tokens.AERO.address}`)
      expect(token.token).toEqual({ ...seed.tokens.AERO, label: OLD } satisfies TokenDto)
      expect(labelsOf(token.pools).get(seed.tokens.AERO.address)).toBe(OLD)

      const gaps = await get<GapsResponse>('/api/gaps?minVolume=0&limit=200')
      const gapLabels = labelsOf(gaps.items.map((item) => item.pool))
      expect(gapLabels.get(SEED_AERO_NEW.address)).toBe(NEW)
      expect(gapLabels.get(seed.tokens.AERO.address)).toBe(OLD)

      const card = await get<ScorecardDetail>(`/api/mm/${SEED_MM_BREACHED_ID}`)
      expect(card.pool?.pool.token0.label).toBe(OLD)
    })

    it('filters by the Aero DEX ids and counts them in their own stats rows', async () => {
      const v2 = await get<PoolsResponse>('/api/pools?dex=aero-v2')
      expect(v2.items.map((item) => item.pool.id)).toEqual([aero.aeroUsdcAeroV2.id])
      const slip = await get<PoolsResponse>('/api/pools?dex=aero-slipstream')
      expect(slip.items.map((item) => item.pool.id)).toEqual([aero.wethUsdcAeroSlip.id])
      const old = await get<PoolsResponse>('/api/pools?dex=aerodrome-v2')
      expect(old.items.map((item) => item.pool.id)).toEqual([seed.pools.aeroUsdcV2.id])

      const stats = await get<StatsResponse>('/api/stats')
      expect(stats.byDex.map((row) => row.dex)).toEqual(DEXES)
      expect(stats.byDex.slice(-2)).toEqual([
        expect.objectContaining({ dex: 'aero-v2', pools: 1, tracked: 1, scored: 1 }),
        expect.objectContaining({ dex: 'aero-slipstream', pools: 1, tracked: 1, scored: 1 }),
      ])
      expect(stats.byDex[4]?.depth2Usd).toBe(80_000)
      expect(stats.byDex[5]?.volume24hUsd).toBe(1_500_000)
    })

    it('lists the fee each snapshot used in the history', async () => {
      const slip = await get<HistoryResponse>(`/api/pools/${aero.wethUsdcAeroSlip.id}/history`)
      expect(slip.points.map((point) => point.feePips)).toEqual([2055, 465])
      const detail = await get<PoolDetail>(`/api/pools/${aero.wethUsdcAeroSlip.id}`)
      expect(detail.latest?.feePips).toBe(465)
      expect(detail.pool.feePips).toBe(465)
      const v2 = await get<HistoryResponse>(`/api/pools/${aero.aeroUsdcAeroV2.id}/history`)
      expect(v2.points.map((point) => point.feePips)).toEqual([3000, 3000])
    })
  })

  it('labels a token outside the scored set against the scored ones', async () => {
    seedAeroTokens(db, seed, { scoreAeroV2: false })
    // Aero's AERO has no scored pool: Aerodrome's keeps the bare symbol, Aero's is named.
    const list = await get<PoolsResponse>('/api/pools?limit=200')
    const labels = labelsOf(list.items)
    expect(labels.get(seed.tokens.AERO.address)).toBe('AERO')
    expect(labels.has(SEED_AERO_NEW.address)).toBe(false)
    const token = await get<TokenDetail>(`/api/tokens/${SEED_AERO_NEW.address}`)
    expect(token.token.label).toBe('AERO (Aero)')
    expect(token.total).toBe(0)
    expect(token.poolCount).toBe(1)
  })

  it('names the two AEROs of an unscored AERO/AERO pool on a database with no scores', async () => {
    const fresh = openDatabase(':memory:')
    const pair = fixturePool({
      dex: 'aero-v2',
      kind: 'stable-swap',
      address: fixtureAddress(0x2003),
      token0: SEED_AERO_NEW,
      token1: seed.tokens.AERO,
      feePips: 500,
      tickSpacing: null,
      stable: true,
    })
    fresh.pools.upsertMany([pair])
    try {
      const res = await createApp(fresh, { now: () => seed.now }).request(`/api/pools/${pair.id}`)
      const detail = (await res.json()) as PoolDetail
      expect(detail.score).toBeNull()
      expect(detail.pool.token0.label).toBe('AERO (Aero)')
      expect(detail.pool.token1.label).toBe('AERO (Aerodrome)')
    } finally {
      fresh.close()
    }
  })

  it('names copycats with the same symbol and name by a short address', async () => {
    const copy = { ...seed.tokens.DEGEN, address: '0x00000000000000000000000000000000000000dd' }
    db.tokens.upsertMany([copy as typeof seed.tokens.DEGEN])
    const token = await get<TokenDetail>(`/api/tokens/${copy.address}`)
    expect(token.token.label).toBe('DEGEN (0x0000…00dd)')
    const degen = await get<TokenDetail>(`/api/tokens/${seed.tokens.DEGEN.address}`)
    expect(degen.token.label).toBe('DEGEN')
  })
})
