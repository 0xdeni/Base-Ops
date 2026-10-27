import { DEXES } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { StatsResponse } from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

describe('GET /api/stats', () => {
  let db: Database
  let seed: Seed
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
  })
  afterEach(() => db.close())

  it('totals by dex in DEXES order', async () => {
    const res = await createApp(db, { now: () => seed.now }).request('/api/stats')
    expect(res.status).toBe(200)
    const body = (await res.json()) as StatsResponse
    expect(body.byDex.map((row) => row.dex)).toEqual(DEXES)
    expect(body.byDex).toEqual([
      {
        dex: 'uniswap-v3',
        pools: 3,
        tracked: 2,
        scored: 2,
        rated: 1,
        depth2Usd: 1_000_000,
        volume24hUsd: 2_000_000,
        medianHealth: 85, // the unrated 22 is left out
      },
      {
        dex: 'uniswap-v4',
        pools: 1,
        tracked: 1,
        scored: 1,
        rated: 1,
        depth2Usd: 12_000,
        volume24hUsd: 300_000,
        medianHealth: 41,
      },
      {
        dex: 'aerodrome-v2',
        pools: 1,
        tracked: 1,
        scored: 1,
        rated: 1,
        depth2Usd: 150_000,
        volume24hUsd: 900_000,
        medianHealth: 62,
      },
      {
        dex: 'aerodrome-slipstream',
        pools: 2,
        tracked: 2,
        scored: 2,
        rated: 1,
        depth2Usd: 402_000,
        volume24hUsd: 19_500,
        medianHealth: 70, // the unrated 48 is left out
      },
    ])
  })

  it('sums the grand totals and takes the median over rated pools only', async () => {
    const res = await createApp(db).request('/api/stats')
    const body = (await res.json()) as StatsResponse
    expect(body.totals).toEqual({
      pools: 7,
      tracked: 6,
      scored: 6,
      rated: 4,
      depth2Usd: 1_564_000,
      volume24hUsd: 3_219_500,
      medianHealth: 66, // (62 + 70) / 2 over the rated [41, 62, 70, 85]; the unrated 22, 48 are out
    })
  })

  it('has no median when no pool is rated, and keeps the unrated ones in scored', async () => {
    db.raw.exec(
      `UPDATE scores SET health_json = json_set(health_json, '$.rated', json('false'), '$.grade', NULL)`,
    )
    const res = await createApp(db).request('/api/stats')
    const body = (await res.json()) as StatsResponse
    expect(body.totals).toMatchObject({ scored: 6, rated: 0, medianHealth: null })
    for (const row of body.byDex) expect(row.medianHealth).toBeNull()
  })

  it('answers with zeros on an empty database', async () => {
    const empty = openDatabase(IN_MEMORY)
    try {
      const res = await createApp(empty).request('/api/stats')
      const body = (await res.json()) as StatsResponse
      expect(body.byDex).toHaveLength(DEXES.length)
      for (const row of body.byDex) {
        expect(row).toMatchObject({
          pools: 0,
          tracked: 0,
          scored: 0,
          rated: 0,
          depth2Usd: 0,
          volume24hUsd: null,
          medianHealth: null,
        })
      }
      expect(body.totals).toEqual({
        pools: 0,
        tracked: 0,
        scored: 0,
        rated: 0,
        depth2Usd: 0,
        volume24hUsd: null,
        medianHealth: null,
      })
    } finally {
      empty.close()
    }
  })
})
