/**
 * Query plans of the score feeds: the scored set (a few hundred rows) drives every count and
 * filtered page, whatever the number of discovered pools and without planner statistics.
 */
import type { PoolMeta } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureScore,
} from '../fixtures.js'

const SCORED: PoolMeta[] = [
  fixturePool({ address: fixtureAddress(1) }),
  fixturePool({
    dex: 'aerodrome-v2',
    kind: 'constant-product',
    address: fixtureAddress(2),
    token0: FIXTURE_AERO,
    token1: FIXTURE_USDC,
    tickSpacing: null,
  }),
  fixturePool({ dex: 'aerodrome-slipstream', address: fixtureAddress(4), token1: FIXTURE_AERO }),
]

describe('ScoresRepo query plans', () => {
  let db: Database
  let prepared: string[]
  let prepare: Database['raw']['prepare']
  beforeEach(() => {
    db = openDatabase(':memory:')
    // Thousands of untracked pools on one pair, as a factory scan leaves them, unanalysed.
    const crowd: PoolMeta[] = []
    for (let i = 0; i < 2_000; i++) {
      crowd.push(
        fixturePool({ id: `uniswap-v3:crowd-${i}`, address: fixtureAddress(0x10_000 + i) }),
      )
    }
    db.pools.upsertMany([...SCORED, ...crowd])
    db.pools.setTracked(
      SCORED.map((p) => p.id),
      true,
    )
    db.scores.upsertMany(SCORED.map((p, i) => fixtureScore({ poolId: p.id, healthTotal: 50 + i })))
    prepared = []
    prepare = db.raw.prepare.bind(db.raw)
    db.raw.prepare = (sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }
  })
  afterEach(() => db.close())

  function plans(): Array<{ sql: string; outer: string }> {
    return prepared
      .filter((sql) => sql.includes('FROM scores s'))
      .map((sql) => {
        const rows = prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
        return { sql, outer: String(rows[0]?.detail) }
      })
  }

  it('scans scores first for pages, counts and the dex stats', () => {
    expect(db.scores.topBy('health', { dex: 'uniswap-v3' }).total).toBe(1)
    expect(db.scores.topBy('tvl', { q: 'weth' }).total).toBe(2)
    expect(db.scores.topBy('depth', { token: FIXTURE_WETH.address }).total).toBe(2)
    expect(db.scores.topBy('gap', { rated: true, minVolumeUsd: 1 }).total).toBe(3)
    expect(db.scores.statsByDex().find((s) => s.dex === 'uniswap-v3')?.pools).toBe(2_001)
    const seen = plans()
    expect(seen.length).toBeGreaterThanOrEqual(9)
    for (const { sql, outer } of seen) expect(outer, sql).toMatch(/^(SCAN|SEARCH) s( |$)/)
  })

  it('scans scores first for the spread sort, the gap counts and a token depth', () => {
    expect(db.scores.topBy('spread', { dex: 'aerodrome-v2' }).total).toBe(1)
    expect(db.scores.gapCounts(0).total).toBe(0)
    expect(db.scores.tokenDepth(FIXTURE_WETH.address).depthKnownPools).toBe(2)
    const seen = plans()
    expect(seen.length).toBeGreaterThanOrEqual(4)
    for (const { sql, outer } of seen) expect(outer, sql).toMatch(/^(SCAN|SEARCH) s( |$)/)
  })

  it('counts pools without the token joins unless q is set', () => {
    expect(db.pools.count()).toBe(2_003)
    expect(db.pools.count({ dex: 'uniswap-v3', tracked: true })).toBe(1)
    expect(db.pools.count({ token: FIXTURE_AERO.address })).toBe(2)
    expect(db.pools.count({ q: 'aero' })).toBe(2)
    const counts = prepared.filter((sql) => sql.startsWith('SELECT COUNT(*) AS n FROM pools p'))
    expect(counts).toHaveLength(4)
    expect(counts.filter((sql) => sql.includes('JOIN tokens'))).toHaveLength(1)
    for (const sql of counts) {
      const outer = String(prepare(`EXPLAIN QUERY PLAN ${sql}`).all()[0]?.detail)
      expect(outer, sql).toMatch(/^(SCAN|SEARCH|MULTI-INDEX OR)/)
      if (!sql.includes('JOIN tokens')) expect(outer, sql).not.toMatch(/\bt0\b|\bt1\b/)
    }
  })
})
