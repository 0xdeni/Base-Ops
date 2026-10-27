/**
 * End-to-end: the demo pipeline over the time-varying synthetic world into an in-memory database,
 * then the API over that database. No network. The pipeline runs a short history here (10 points,
 * 18 h); demoHistory.test.ts runs the full seven days.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createApp,
  type HistoryResponse,
  type PoolDetail,
  type PoolsResponse,
} from '@depthwatch/api'
import {
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_POOL_IDS,
  SYNTHETIC_PRICES,
  syntheticEventsAt,
  syntheticWorld,
  TOKENS,
} from '@depthwatch/chain'
import { DEXES, type HealthGrade, summarizeScorecard } from '@depthwatch/core'
import { type Database, fixturePool, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'
import {
  DEMO_MANDATES,
  DEMO_MARKER_KEY,
  DemoDatabaseError,
  type DemoPipelineResult,
  demoCommand,
  demoHistoryTimestamps,
  openDemoDatabase,
  runDemoPipeline,
} from './demo.js'
import { silentLogger } from './log.js'

const GRADES: readonly HealthGrade[] = ['A', 'B', 'C', 'D', 'F']
const LIVE_CURSOR = 60_000_000n
const NOW = SYNTHETIC_DEFAULTS.latestTimestamp
const SHORT_HISTORY = 10

/** A file database as a live run leaves it: one real pool, tracked, and a discover cursor. */
function seedLiveDatabase(path: string): void {
  const db = openDatabase(path)
  try {
    db.pools.upsertMany([fixturePool()])
    db.pools.setTracked([fixturePool().id], true)
    db.syncState.setBigInt('discover:uniswap-v3:lastBlock', LIVE_CURSOR)
  } finally {
    db.close()
  }
}
const within = (value: number | null, expected: number, pct: number) =>
  value !== null && Math.abs(value / expected - 1) <= pct / 100

describe('demo pipeline (end to end, offline, short history)', () => {
  let db: Database
  let result: DemoPipelineResult
  const timestamps = demoHistoryTimestamps(NOW, SHORT_HISTORY)
  const world = syntheticWorld({ epochTimestamp: NOW })

  beforeAll(async () => {
    db = openDatabase(':memory:')
    result = await runDemoPipeline({
      db,
      config: loadConfig({}),
      log: silentLogger,
      historyPoints: SHORT_HISTORY,
    })
  }, 30_000)

  afterAll(() => db.close())

  it('discovers pools for all four DEXes once, at the first point', () => {
    expect(result.now).toBe(NOW)
    expect(result.history.timestamps).toEqual(timestamps)
    expect(result.discover.found).toBe(6)
    expect(result.discover.failed).toEqual([])
    const first = syntheticWorld({ epochTimestamp: timestamps[0] })
    expect(result.discover.blockNumber).toBe(first.latestBlock)
    for (const dex of DEXES) expect(db.pools.count({ dex })).toBeGreaterThanOrEqual(1)
    for (const dex of DEXES)
      expect(db.syncState.getBigInt(`discover:${dex}:lastBlock`)).toBe(result.discover.blockNumber)
  })

  it('tracks the pools and stores one snapshot per point each, with USD depth for USDC-quoted pools', () => {
    const tracked = db.pools.trackedIds()
    expect(tracked).toHaveLength(6)
    expect(result.snapshot.snapshots).toBe(6)
    expect(result.history.snapshots).toBe(6 * SHORT_HISTORY)
    expect(result.history.failed).toEqual([])
    expect(result.snapshot.failed).toEqual([])
    expect(result.snapshot.blockNumber).toBe(world.latestBlock)
    for (const id of tracked) {
      const pool = db.pools.get(id)
      const snapshot = db.snapshots.latestForPool(id)
      expect(pool).toBeDefined()
      expect(snapshot).toBeDefined()
      if (!pool || !snapshot) continue
      const series = db.snapshots.seriesForPool(id, 0)
      expect(series.map((s) => s.timestamp)).toEqual(timestamps)
      expect(new Set(series.map((s) => s.depthUsd.find((d) => d.pct === 2)?.totalUsd)).size).toBe(
        SHORT_HISTORY,
      )
      expect(snapshot.blockNumber).toBe(result.snapshot.blockNumber)
      expect(snapshot.price).toBeGreaterThan(0)
      expect(snapshot.depth.map((d) => d.pct)).toEqual([1, 2, 5])
      const usdcQuoted = [pool.token0.address, pool.token1.address].includes(TOKENS.USDC.address)
      if (usdcQuoted) {
        const depth2 = snapshot.depthUsd.find((d) => d.pct === 2)
        expect(depth2?.totalUsd).not.toBeNull()
        expect(depth2?.totalUsd ?? 0).toBeGreaterThan(0)
      }
      if (pool.dex === 'uniswap-v4') expect(snapshot.tvlUsd).toBeNull()
      else expect(snapshot.tvlUsd ?? 0).toBeGreaterThan(0)
      if (pool.kind === 'concentrated') {
        // Four owners hold positions; one may sit outside the ±5 % band as the price drifts.
        expect(snapshot.concentration?.owners?.count).toBeGreaterThanOrEqual(3)
        expect(snapshot.concentration?.owners?.count).toBeLessThanOrEqual(4)
      } else {
        expect(snapshot.concentration).toMatchObject({ rangeHhi: 1, owners: null })
      }
    }
  })

  it('indexes positions before the snapshot, at the liquidity of the last point', () => {
    expect(result.positions.failed).toEqual([])
    expect(result.positions.positions).toBeGreaterThan(0)
    for (const pool of db.pools.list()) {
      const count = db.positions.countForPool(pool.id)
      if (pool.kind !== 'concentrated') {
        expect(count).toBe(0)
        continue
      }
      const synthetic = world.pools.find((p) => p.meta.id === pool.id)
      if (synthetic?.kind !== 'concentrated') throw new Error('pool missing')
      const stored = new Map(db.positions.forPool(pool.id).map((p) => [p.tokenId, p.liquidity]))
      for (const p of synthetic.positions) expect(stored.get(p.tokenId)).toBe(p.liquidity)
    }
  })

  it('derives the drifted prices of the last point through USDC', () => {
    const [v3] = world.pools
    const eth = v3?.token0Usd ?? 0
    expect(within(db.prices.usd(TOKENS.WETH.address), eth, 0.5)).toBe(true)
    expect(within(db.prices.usd(TOKENS.WETH.address), SYNTHETIC_PRICES.ETH, 4)).toBe(true)
    const cbbtc = world.pools[1]?.token1Usd ?? 0
    expect(within(db.prices.usd(TOKENS.CBBTC.address), cbbtc, 0.5)).toBe(true)
    const aero = world.pools[3]?.token1Usd ?? 0
    expect(within(db.prices.usd(TOKENS.AERO.address), aero, 0.5)).toBe(true)
    // Native ETH (Uniswap v4 currency0) is tied to WETH.
    expect(within(db.prices.usd('0x0000000000000000000000000000000000000000'), eth, 0.5)).toBe(true)
    expect(db.prices.usd(TOKENS.USDC.address)).toBe(1)
  })

  it('buckets the 24 h of swaps before now with USD volume', () => {
    expect(result.volume.swaps).toBe(world.pools.reduce((n, p) => n + p.swapCount, 0))
    expect(result.volume.dropped).toBe(0)
    expect(result.volume.unpricedPools).toBe(0)
    expect(result.volume.buckets).toBeGreaterThan(24)
    for (const id of db.pools.trackedIds()) {
      const usd = db.volume.sumUsd(id, NOW - 86_400)
      expect(usd).not.toBeNull()
      expect(usd ?? 0).toBeGreaterThan(10_000)
    }
  })

  it('scores every tracked pool with a grade over the history', () => {
    expect(result.score.scored).toBe(6)
    expect(result.score.unsnapshotted).toBe(0)
    for (const id of db.pools.trackedIds()) {
      const score = db.scores.get(id)
      expect(score).toBeDefined()
      if (!score) continue
      expect(score.timestamp).toBe(NOW)
      expect(GRADES).toContain(score.health.grade)
      expect(score.health.total).toBeGreaterThanOrEqual(0)
      expect(score.health.total).toBeLessThanOrEqual(100)
      expect(score.depth2Usd ?? 0).toBeGreaterThan(0)
      expect(score.volume24hUsd ?? 0).toBeGreaterThan(0)
      expect(score.gap.gapScore).not.toBeNull()
      // Every point but none of the lead-in lies inside the last 24 h.
      expect(score.persistence24h.samples).toBe(SHORT_HISTORY)
      expect(score.persistence24h.stability ?? 1).toBeLessThan(1)
    }
  })

  it('registers the two demo mandates at the first point and samples both at every point', () => {
    expect(result.mandates.map((m) => m.id)).toEqual([
      'demo-slipstream-weth-usdc',
      'demo-aero-usdc-aero',
    ])
    expect(db.mandates.count({ active: true })).toBe(2)
    expect(result.snapshot.samples).toBe(2)
    expect(result.history.samples).toBe(2 * SHORT_HISTORY)
    expect(result.snapshot.sampleFailures).toBe(0)
    expect(result.snapshot.alerts).toBe(0)
    expect(db.mmAlerts.count()).toBe(0)
    const statuses = new Map<string, string>()
    for (const mandate of result.mandates) {
      expect(mandate.createdAt).toBe(timestamps[0])
      expect(mandate.alertWebhookUrl).toBeNull()
      expect(db.pools.get(mandate.poolId)?.id).toBe(mandate.poolId)
      const samples = db.mmSamples.seriesFor(mandate.id, 0)
      expect(samples.map((s) => s.timestamp)).toEqual(timestamps)
      expect(samples.at(-1)?.blockNumber).toBe(result.snapshot.blockNumber)
      const summary = summarizeScorecard(mandate, samples, NOW)
      statuses.set(mandate.id, summary.status)
      expect(summary.uptime.h24.samples).toBe(SHORT_HISTORY)
    }
    expect(statuses.get('demo-slipstream-weth-usdc')).toBe('ok')
    expect(statuses.get('demo-aero-usdc-aero')).toBe('breached')
    const slipstream = db.mmSamples.latestFor('demo-slipstream-weth-usdc')
    expect(slipstream?.poolId).toBe(SYNTHETIC_POOL_IDS.wethUsdcSlipstream)
    expect(slipstream?.attribution).toMatchObject({ method: 'positions', holdings: 1 })
    const aero = db.mmSamples.latestFor('demo-aero-usdc-aero')
    expect(aero?.poolId).toBe(SYNTHETIC_POOL_IDS.usdcAeroV2)
    expect(aero?.attribution).toMatchObject({ method: 'lp-share', holdings: 1 })
    expect(aero?.breaches).toEqual(['depthUp', 'depthDown'])
  })

  it('describes the demo mandates in plain language (their notes are shown to visitors)', () => {
    for (const { id, notes } of DEMO_MANDATES) {
      expect(notes, id).toMatch(/^Synthetic mandate: /)
      // No source identifiers (SYNTHETIC_OWNERS[1]) or raw tick bounds ([-300, 300]).
      expect(notes, id).not.toMatch(/[A-Z]+_[A-Z_]+|\[-?\d+, -?\d+\]/)
    }
  })

  it('samples the AERO mandate both within KPI and breached as its market maker moves', () => {
    const samples = db.mmSamples.seriesFor('demo-aero-usdc-aero', 0)
    for (const sample of samples)
      expect(sample.withinKpi).toBe(!syntheticEventsAt(sample.timestamp).aeroMarketMakerOut)
    expect(samples.some((s) => s.withinKpi === true)).toBe(true)
    expect(samples.some((s) => s.withinKpi === false)).toBe(true)
  })

  it('lists the thin AERO/USDC pool first in the gaps feed', () => {
    const gaps = db.scores.gaps()
    expect(gaps.length).toBeGreaterThan(0)
    const first = gaps[0]
    expect(first?.pool.dex).toBe('aerodrome-v2')
    expect(first?.pool.token1.symbol).toBe('AERO')
    expect(first?.score.gap.gapScore ?? 0).toBeGreaterThan(50)
    expect(result.score.gaps).toBe(gaps.length)
  })

  it('serves /api/pools, /api/pools/:id and its history over the demo database', async () => {
    const app = createApp(db, { now: () => NOW })
    const list = await app.request('/api/pools?sort=health&limit=10')
    expect(list.status).toBe(200)
    const body = (await list.json()) as PoolsResponse
    expect(body.total).toBe(6)
    expect(body.items).toHaveLength(6)
    const first = body.items[0]
    expect(first?.health.grade).toBeDefined()
    expect(first?.depth2Usd ?? 0).toBeGreaterThan(0)

    const id = first?.pool.id as string
    const detail = await app.request(`/api/pools/${id}`)
    expect(detail.status).toBe(200)
    const pool = (await detail.json()) as PoolDetail
    expect(pool.pool.id).toBe(id)
    expect(pool.tracked).toBe(true)
    expect(pool.latest?.poolId).toBe(id)
    expect(pool.score?.grade).toBe(first?.health.grade)
    expect(pool.volume24hUsd ?? 0).toBeGreaterThan(0)

    const history = await app.request(`/api/pools/${encodeURIComponent(id)}/history?window=24h`)
    expect(history.status).toBe(200)
    const series = (await history.json()) as HistoryResponse
    expect(series.points.map((p) => p.timestamp)).toEqual(timestamps)

    const missing = await app.request(
      '/api/pools/uniswap-v3:0x0000000000000000000000000000000000000000',
    )
    expect(missing.status).toBe(404)
  })
})

describe('demoCommand', () => {
  it('runs the pipeline and serves on a free port until aborted', async () => {
    const controller = new AbortController()
    const lines: string[] = []
    let url: string | undefined
    const done = demoCommand({
      config: loadConfig(
        { DEPTHWATCH_ADMIN_TOKEN: 'demo-token' },
        { port: '0', host: '127.0.0.1' },
      ),
      log: silentLogger,
      signal: controller.signal,
      historyPoints: 4,
      stdout: (line) => lines.push(line),
      onListening: (listening) => {
        url = listening
      },
    })
    const listening = new Promise<void>((resolve) => {
      const tick = () => (url ? resolve() : setTimeout(tick, 20))
      tick()
    })
    await listening
    try {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(lines[0]).toContain(`Depthwatch listening on ${url}`)
      const health = await fetch(`${url}/api/health`)
      expect(health.status).toBe(200)
      // `source: 'demo'` tells the dashboard to show the demo banner (docs/design/web-v2.md §1).
      expect((await health.json()) as { poolCount: number }).toMatchObject({
        poolCount: 6,
        trackedCount: 6,
        source: 'demo',
      })
      const index = await fetch(`${url}/`, { headers: { accept: 'text/html' } })
      expect([200, 404]).toContain(index.status)
      // The demo serves both mandates and honours DEPTHWATCH_ADMIN_TOKEN like `serve` does.
      const scorecards = await fetch(`${url}/api/mm`)
      expect(scorecards.status).toBe(200)
      const { items } = (await scorecards.json()) as { items: Array<{ status: string }> }
      expect(items.map((item) => item.status).sort()).toEqual(['breached', 'ok'])
      const badge = await fetch(`${url}/api/mm/demo-slipstream-weth-usdc/badge.svg`)
      expect(badge.headers.get('content-type')).toBe('image/svg+xml')
      const anonymous = await fetch(`${url}/api/mm`, { method: 'POST', body: '{}' })
      expect(anonymous.status).toBe(401)
    } finally {
      controller.abort()
      await done
    }
  }, 20_000)

  it('runs in memory when .env sets DEPTHWATCH_DB, leaving the live database untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-demo-'))
    try {
      const file = join(dir, 'depthwatch.db')
      seedLiveDatabase(file)
      const controller = new AbortController()
      controller.abort() // the pipeline still runs; only serving is skipped
      await demoCommand({
        config: loadConfig({ DEPTHWATCH_DB: file }, { port: '0', host: '127.0.0.1' }),
        log: silentLogger,
        signal: controller.signal,
        historyPoints: 4,
      })
      const db = openDatabase(file)
      try {
        expect(db.pools.count()).toBe(1)
        expect(db.pools.trackedIds()).toEqual([fixturePool().id])
        expect(db.syncState.getBigInt('discover:uniswap-v3:lastBlock')).toBe(LIVE_CURSOR)
        for (const dex of DEXES.filter((d) => d !== 'uniswap-v3'))
          expect(db.syncState.getBigInt(`discover:${dex}:lastBlock`)).toBeUndefined()
        expect(db.syncState.get(DEMO_MARKER_KEY)).toBeUndefined()
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

describe('openDemoDatabase', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-demo-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('ignores DEPTHWATCH_DB and opens an in-memory database', () => {
    const file = join(dir, 'live.db')
    const config = loadConfig({ DEPTHWATCH_DB: file })
    expect(config.dbPathSource).toBe('env')
    const db = openDemoDatabase(config)
    try {
      expect(db.path).toBe(IN_MEMORY)
    } finally {
      db.close()
    }
    expect(existsSync(file)).toBe(false)
  })

  it('accepts an empty --db file, marks it, and accepts it again on the next run', () => {
    const file = join(dir, 'demo.db')
    const live = join(dir, 'live.db')
    const first = openDemoDatabase(loadConfig({ DEPTHWATCH_DB: live }, { db: file }))
    try {
      expect(first.path).toBe(file)
      expect(first.syncState.get(DEMO_MARKER_KEY)).toBe('1')
      first.pools.upsertMany([fixturePool()])
      first.syncState.setBigInt('discover:uniswap-v3:lastBlock', 52_950_000n)
    } finally {
      first.close()
    }
    const again = openDemoDatabase(loadConfig({}, { db: file }))
    try {
      expect(again.pools.count()).toBe(1)
    } finally {
      again.close()
    }
    expect(existsSync(live)).toBe(false)
  })

  it('refuses a --db file holding data from a live run and leaves it untouched', () => {
    const file = join(dir, 'live.db')
    seedLiveDatabase(file)
    const config = loadConfig({}, { db: file })
    expect(() => openDemoDatabase(config)).toThrow(DemoDatabaseError)
    expect(() => openDemoDatabase(config)).toThrow(/already holds 1 pool\(s\) and 1 sync_state/)
    const db = openDatabase(file)
    try {
      expect(db.pools.count()).toBe(1)
      expect(db.pools.trackedIds()).toEqual([fixturePool().id])
      expect(db.syncState.getBigInt('discover:uniswap-v3:lastBlock')).toBe(LIVE_CURSOR)
      expect(db.syncState.get(DEMO_MARKER_KEY)).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
