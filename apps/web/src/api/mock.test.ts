import { DEXES, GAP_FEED_MIN_VOLUME_USD } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { createMockClient, toRawAmount } from './mock.js'
import type { PoolSummary } from './types.js'

const NOW = 1_760_000_000
const client = createMockClient({ now: NOW })
const WETH = '0x4200000000000000000000000000000000000006'

describe('mock client', () => {
  it('serves 10–20 pools across all four DEXes', async () => {
    const { items, total } = await client.pools({ limit: 100 })
    expect(total).toBeGreaterThanOrEqual(10)
    expect(total).toBeLessThanOrEqual(20)
    expect(items).toHaveLength(total)
    const dexes = new Set(items.map((i) => i.pool.dex))
    expect(dexes).toEqual(new Set(DEXES))
    for (const item of items) {
      expect(item.health.total).toBeGreaterThan(0)
      // an unpriced pool has no depth in dollars
      if (item.health.unratedReason !== 'unpriced') expect(item.depth2Usd).toBeGreaterThan(0)
      expect(item.pool.token0.address).toMatch(/^0x[0-9a-f]{40}$/)
      expect(item.pool.createdAtBlock).toMatch(/^\d+$/)
    }
  })

  it('has rated and unrated pools, each unrated reason once, and keeps the unrated last', async () => {
    const all = await client.pools({ limit: 100 })
    const rated = await client.pools({ rated: true, limit: 100 })
    const unrated = await client.pools({ rated: false, limit: 100 })
    expect(rated.total + unrated.total).toBe(all.total)
    expect(rated.items.every((i) => i.health.rated && i.health.grade !== null)).toBe(true)
    expect(rated.items.every((i) => i.health.unratedReason === null)).toBe(true)
    expect(unrated.items.map((i) => i.health.unratedReason).sort()).toEqual([
      'one-sided',
      'thin',
      'unpriced',
    ])
    for (const item of unrated.items) {
      expect(item.health.grade).toBeNull()
      expect(item.health.rated).toBe(false)
      expect(item.health.total).toBeGreaterThan(0) // the numbers are kept
    }
    // sorting by health puts the unrated pools last in both directions
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = await client.pools({ sort: 'health', dir, limit: 100 })
      const flags = sorted.items.map((i) => i.health.rated)
      expect(flags.indexOf(false)).toBe(rated.total)
      expect(flags.slice(rated.total).every((f) => !f)).toBe(true)
    }
    // the sides behind the reasons: one empty side, and no USD price at all
    const bySide = Object.fromEntries(unrated.items.map((i) => [i.health.unratedReason, i]))
    expect(bySide['one-sided']?.depth2DownUsd).toBe(0)
    expect(bySide['one-sided']?.depth2UpUsd).toBeGreaterThan(5_000)
    expect(bySide.thin?.depth2UpUsd).toBeLessThan(5_000)
    // WETH / TOSHI: the sell side is WETH, which has a price; the buy side is TOSHI, which has none
    expect(bySide.unpriced).toMatchObject({
      depth2UpUsd: null,
      depth2DownUsd: 42_000,
      depth2Usd: 42_000,
      tvlUsd: null,
      volume24hUsd: null,
    })
    // an unrated pool answers its detail too, with the same rating
    const id = bySide.thin?.pool.id ?? ''
    expect((await client.pool(id)).score).toMatchObject({ rated: false, unratedReason: 'thin' })
  })

  it('counts the rated pools and takes the median health over them only', async () => {
    const { byDex, totals } = await client.stats()
    const rated = await client.pools({ rated: true, limit: 100 })
    expect(totals.rated).toBe(rated.total)
    expect(totals.scored).toBe(rated.total + 3)
    expect(byDex.reduce((sum, s) => sum + s.rated, 0)).toBe(totals.rated)
    const sorted = rated.items.map((i) => i.health.total).sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    expect(totals.medianHealth).toBe(median)
  })

  it('sorts, filters and paginates like the API contract', async () => {
    const byDepth = await client.pools({ sort: 'depth', dir: 'desc', limit: 3 })
    expect(byDepth.items).toHaveLength(3)
    const depths = byDepth.items.map((i) => i.depth2Usd ?? 0)
    expect([...depths].sort((a, b) => b - a)).toEqual(depths)

    const v4 = await client.pools({ dex: 'uniswap-v4' })
    expect(v4.items.every((i) => i.pool.dex === 'uniswap-v4')).toBe(true)
    expect(v4.total).toBe(v4.items.length)

    const search = await client.pools({ q: 'cbbtc' })
    expect(search.total).toBeGreaterThan(0)
    expect(
      search.items.every((i) => /cbBTC/.test(`${i.pool.token0.symbol}${i.pool.token1.symbol}`)),
    ).toBe(true)

    const page2 = await client.pools({ sort: 'tvl', limit: 5, offset: 5 })
    const page1 = await client.pools({ sort: 'tvl', limit: 5, offset: 0 })
    expect(page1.items.map((i) => i.pool.id)).not.toEqual(page2.items.map((i) => i.pool.id))
    expect(page2.total).toBe(page1.total)

    const floor = await client.pools({ minVolume: 10_000_000 })
    expect(floor.items.every((i) => (i.volume24hUsd ?? 0) >= 10_000_000)).toBe(true)
    expect(floor.total).toBeLessThan(page1.total)

    // Defaults and clamping match the API (limit 50 max 200, offset 0).
    const all = await client.pools()
    expect(all.items.length).toBe(all.total)
    expect((await client.pools({ limit: 0 })).items).toHaveLength(1)
  })

  it('returns a consistent detail payload with bigints as decimal strings', async () => {
    const { items } = await client.pools({ sort: 'depth', limit: 1 })
    const id = items[0]?.pool.id ?? ''
    const detail = await client.pool(id)
    expect(detail.pool.id).toBe(id)
    expect(detail.tracked).toBe(true)
    expect(detail.scoredAt).toBe(NOW)
    expect(detail.latest?.blockNumber).toMatch(/^\d+$/)
    expect(detail.latest?.activeLiquidity).toMatch(/^\d+$/)
    expect(detail.latest?.depth.map((d) => d.pct)).toEqual([1, 2, 5])
    for (const level of detail.latest?.depth ?? []) {
      expect(level.up.amountIn).toMatch(/^\d+$/)
      expect(level.down.amountIn).toMatch(/^\d+$/)
    }
    expect(detail.score?.total).toBe(items[0]?.health.total)
    const components = detail.score?.components
    expect(components).toBeDefined()
    if (components) {
      expect(
        components.depth + components.spread + components.concentration + components.persistence,
      ).toBeCloseTo(detail.score?.total ?? 0, 1)
    }
    expect(detail.gap?.depth2Usd).toBe(items[0]?.depth2Usd)
    expect(detail.volume24hUsd).toBe(items[0]?.volume24hUsd)
    expect(detail.latest?.timestamp).toBe(items[0]?.updatedAt)
  })

  it('carries the ±2 % sides of each pool snapshot on every PoolSummary', async () => {
    const { items } = await client.pools({ limit: 200 })
    for (const item of items) {
      const level = (await client.pool(item.pool.id)).latest?.depthUsd.find((l) => l.pct === 2)
      expect(level, item.pool.id).toBeDefined()
      expect(item.depth2UpUsd, item.pool.id).toBe(level?.upUsd)
      expect(item.depth2DownUsd, item.pool.id).toBe(level?.downUsd)
      expect((item.depth2UpUsd ?? 0) + (item.depth2DownUsd ?? 0)).toBeCloseTo(
        item.depth2Usd ?? 0,
        6,
      )
    }
    const listed = new Map(items.map((item) => [item.pool.id, item]))
    const sides = (s: PoolSummary) => ({ up: s.depth2UpUsd, down: s.depth2DownUsd })
    const expectListedSides = (s: PoolSummary) => {
      const row = listed.get(s.pool.id)
      expect(row, s.pool.id).toBeDefined()
      if (row) expect(sides(s), s.pool.id).toEqual(sides(row))
    }
    for (const gap of (await client.gaps({ limit: 100 })).items) expectListedSides(gap.pool)
    for (const pool of (await client.token(WETH)).pools) expectListedSides(pool)
    for (const { mandate } of (await client.scorecards()).items) {
      const { pool } = await client.scorecard(mandate.id)
      expect(pool, mandate.id).not.toBeNull()
      if (pool) expectListedSides(pool)
    }
  })

  it('answers unknown ids with the API error bodies', async () => {
    await expect(client.pool('uniswap-v3:0xdead')).rejects.toMatchObject({
      status: 404,
      message: 'pool not found',
    })
    await expect(client.token('0x00000000000000000000000000000000000000aa')).rejects.toMatchObject({
      status: 404,
      message: 'token not found',
    })
    await expect(client.token('0xdead')).rejects.toMatchObject({
      status: 400,
      message: 'invalid token address: expected 0x + 40 hex chars',
    })
  })

  it('generates deterministic histories ending at the latest snapshot', async () => {
    const { items } = await client.pools({ limit: 1 })
    const id = items[0]?.pool.id ?? ''
    const detail = await client.pool(id)
    const a = await client.history(id, '24h')
    const b = await client.history(id)
    expect(a).toEqual(b)
    expect(a.window).toBe('24h')
    expect(a.to).toBe(detail.latest?.timestamp)
    expect(a.from).toBe(a.to - 86_400)
    expect(a.points.length).toBeGreaterThan(100)
    expect(a.points.at(-1)?.timestamp).toBe(a.to)
    expect(a.points.every((p) => p.timestamp >= a.from && p.timestamp <= a.to)).toBe(true)
    for (let i = 1; i < a.points.length; i++) {
      expect(a.points[i]?.timestamp).toBeGreaterThan(a.points[i - 1]?.timestamp ?? 0)
    }
    for (const point of a.points) {
      expect(point.health).toBeGreaterThanOrEqual(0)
      expect(point.health).toBeLessThanOrEqual(100)
      expect(point.price).toBeGreaterThan(0)
      expect(point.tvlUsd).toBeGreaterThan(0)
    }
    const week = await client.history(id, '7d')
    expect(week.window).toBe('7d')
    expect(week.from).toBe(week.to - 7 * 86_400)
    expect((week.points[0]?.timestamp ?? 0) < (a.points[0]?.timestamp ?? 0)).toBe(true)
    await expect(client.history('uniswap-v3:0xdead')).rejects.toMatchObject({ status: 404 })
  })

  it('ranks gaps by score among pools with ≥ $10k volume, with the floor echoed', async () => {
    const { items, minVolumeUsd } = await client.gaps({ limit: 100 })
    expect(minVolumeUsd).toBe(GAP_FEED_MIN_VOLUME_USD)
    expect(items.length).toBeGreaterThan(0)
    const scores = items.map((g) => g.gap.gapScore ?? -1)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    for (const g of items) {
      expect(g.gap.volume24hUsd ?? 0).toBeGreaterThanOrEqual(GAP_FEED_MIN_VOLUME_USD)
      expect(g.pool.gapScore).toBe(g.gap.gapScore)
    }
    expect((await client.gaps({ limit: 3 })).items).toHaveLength(3)
    const page = await client.gaps({ limit: 2, offset: 1 })
    expect(page.items.map((g) => g.pool.pool.id)).toEqual(
      items.slice(1, 3).map((g) => g.pool.pool.id),
    )
    const high = await client.gaps({ minVolume: 10_000_000 })
    expect(high.minVolumeUsd).toBe(10_000_000)
    expect(high.items.every((g) => (g.gap.volume24hUsd ?? 0) >= 10_000_000)).toBe(true)
    // The counts are the whole feed's at the floor, like the API's, on every page.
    const meaningful = items.filter((g) => (g.gap.turnoverRatio ?? 0) >= 3).length
    expect(page).toMatchObject({ total: items.length, meaningful })
    expect(high.total).toBe(high.items.length)
  })

  it('resolves tokens by address, case-insensitively, with their sorted and paged pools', async () => {
    const weth = await client.token(WETH.toUpperCase())
    expect(weth.token.symbol).toBe('WETH')
    expect(weth.usd).toBeGreaterThan(0)
    expect(weth.priceUpdatedAt).toBe(NOW)
    expect(weth.pools.length).toBeGreaterThan(3)
    expect(weth.total).toBe(weth.pools.length)
    expect(weth.poolCount).toBeGreaterThanOrEqual(weth.total)
    expect(
      weth.pools.every(
        (p) =>
          p.pool.token0.address === weth.token.address ||
          p.pool.token1.address === weth.token.address,
      ),
    ).toBe(true)
    const depths = weth.pools.map((p) => p.depth2Usd ?? 0)
    expect([...depths].sort((a, b) => b - a)).toEqual(depths)

    const byHealthAsc = await client.token(WETH, { sort: 'health', dir: 'asc', limit: 2 })
    expect(byHealthAsc.pools).toHaveLength(2)
    expect(byHealthAsc.total).toBe(weth.total)
    const totals = byHealthAsc.pools.map((p) => p.health.total)
    expect([...totals].sort((a, b) => a - b)).toEqual(totals)
    const rest = await client.token(WETH, { sort: 'health', dir: 'asc', offset: 2 })
    expect(rest.pools).toHaveLength(weth.total - 2)
    // The token's depth covers every pool, whatever the page.
    const all = await client.token(WETH, { limit: 200 })
    const known = all.pools.filter((p) => p.depth2Usd !== null)
    const sum = known.reduce((total, p) => total + (p.depth2Usd ?? 0), 0)
    expect(byHealthAsc).toMatchObject({ depth2UsdTotal: sum, depthKnownPools: known.length })
  })

  it('reports stats per dex in DEXES order plus totals, and a healthy /health', async () => {
    const { byDex, totals } = await client.stats()
    expect(byDex.map((s) => s.dex)).toEqual(DEXES)
    for (const s of byDex) {
      expect(s.tracked).toBeGreaterThan(0)
      expect(s.scored).toBe(s.tracked)
      expect(s.pools).toBeGreaterThanOrEqual(s.tracked)
      expect(s.medianHealth).not.toBeNull()
    }
    expect(totals.pools).toBe(byDex.reduce((sum, s) => sum + s.pools, 0))
    expect(totals.scored).toBe(byDex.reduce((sum, s) => sum + s.scored, 0))
    expect(totals.depth2Usd).toBeCloseTo(
      byDex.reduce((sum, s) => sum + s.depth2Usd, 0),
      6,
    )
    expect(totals.medianHealth).not.toBeNull()
    const health = await client.health()
    expect(health.ok).toBe(true)
    expect(health.latestSnapshotAt).toBe(NOW)
    expect(health.trackedCount).toBe(totals.tracked)
    expect(health.poolCount).toBe(totals.pools)
    expect(health.latestBlock).toMatch(/^\d+$/)
  })
})

describe('toRawAmount', () => {
  it('scales human amounts to raw decimal strings', () => {
    expect(toRawAmount(1, 18)).toBe('1000000000000000000')
    expect(toRawAmount(3_400_000, 6)).toBe('3400000000000')
    expect(toRawAmount(0.5, 8)).toBe('50000000')
    expect(toRawAmount(0, 18)).toBe('0')
    expect(toRawAmount(-1, 18)).toBe('0')
  })
})
