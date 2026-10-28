import { computeUptime, summarizeScorecard, toJsonSafe, toPublicMandate } from '@depthwatch/core'
import { type Database, fixtureMandate, fixtureMmSample } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { BADGE_CACHE_CONTROL, BADGE_COLOURS } from '../badge.js'
import type {
  ErrorResponse,
  SamplesResponse,
  ScorecardDetail,
  ScorecardSummaryDto,
  ScorecardsResponse,
} from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

const DAY = 86_400

describe('GET /api/mm', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  async function list(query = ''): Promise<ScorecardsResponse> {
    const res = await app.request(`/api/mm${query}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    return (await res.json()) as ScorecardsResponse
  }

  it('lists every mandate as a scorecard summary, by name', async () => {
    const body = await list()
    expect(body.items.map((item) => item.mandate.id)).toEqual([
      seed.mandates.aeroBreached.id,
      seed.mandates.slipstreamOk.id,
    ])
    const [breached, ok] = body.items as [ScorecardSummaryDto, ScorecardSummaryDto]
    expect(breached.status).toBe('breached')
    expect(ok.status).toBe('ok')
    expect(Object.keys(ok).sort()).toEqual(
      ['latest', 'mandate', 'status', 'streak', 'uptime', 'worst'].sort(),
    )
  })

  it('matches core summarizeScorecard over the 30-day series, jsonified', async () => {
    const body = await list()
    for (const item of body.items) {
      const mandate =
        seed.mandates[
          item.mandate.id === seed.mandates.slipstreamOk.id ? 'slipstreamOk' : 'aeroBreached'
        ]
      const samples = (seed.mmSamples.get(mandate.id) ?? []).filter(
        (s) => s.timestamp >= seed.now - 30 * DAY,
      )
      const summary = summarizeScorecard(mandate, samples, seed.now)
      expect(item).toEqual(toJsonSafe({ ...summary, mandate: toPublicMandate(summary.mandate) }))
    }
  })

  it('reports the seed uptimes: ok mandate 24h = 1 with a 7d dip, breached mandate 24h = 0', async () => {
    const body = await list()
    const ok = body.items.find((i) => i.mandate.id === seed.mandates.slipstreamOk.id)
    const breached = body.items.find((i) => i.mandate.id === seed.mandates.aeroBreached.id)
    expect(ok?.uptime.h24.uptime).toBe(1)
    expect(ok?.uptime.d7.uptime).toBeGreaterThan(0.9)
    expect(ok?.uptime.d7.uptime).toBeLessThan(1)
    expect(ok?.uptime.d30.uptime).toBeLessThan(1)
    expect(ok?.streak).toMatchObject({ breached: false })
    expect(ok?.worst.minDepthDownUsd?.value).toBe(42_000)
    expect(ok?.worst.maxSpreadBps).toBeNull()
    expect(breached?.uptime.h24.uptime).toBe(0)
    expect(breached?.uptime.d7.uptime).toBeCloseTo(6 / 25, 9)
    expect(breached?.streak).toMatchObject({ breached: true, samples: 19 })
    expect(breached?.latest?.breaches).toEqual(['depthUp', 'depthDown'])
    expect(breached?.worst.maxSpreadBps?.threshold).toBe(40)
  })

  it('puts active mandates first, then by name', async () => {
    db.mandates.setActive(seed.mandates.aeroBreached.id, false)
    db.mandates.upsert(
      fixtureMandate({ id: 'aaa-first', name: 'AAA inactive', active: false, poolId: 'nope' }),
    )
    db.mandates.upsert(fixtureMandate({ id: 'zzz-last', name: 'zzz active', poolId: 'nope' }))
    const body = await list()
    expect(body.items.map((item) => item.mandate.id)).toEqual([
      seed.mandates.slipstreamOk.id,
      'zzz-last',
      'aaa-first',
      seed.mandates.aeroBreached.id,
    ])
    expect(body.items.map((item) => item.status)).toEqual(['ok', 'no-data', 'inactive', 'inactive'])
  })

  it('filters by pool and by active', async () => {
    db.mandates.setActive(seed.mandates.aeroBreached.id, false)
    const byPool = await list(`?pool=${encodeURIComponent(seed.pools.wethAeroSlip.id)}`)
    expect(byPool.items.map((i) => i.mandate.id)).toEqual([seed.mandates.slipstreamOk.id])
    expect((await list('?pool=uniswap-v3:0xnope')).items).toEqual([])
    const active = await list('?active=true')
    expect(active.items.map((i) => i.mandate.id)).toEqual([seed.mandates.slipstreamOk.id])
    const inactive = await list('?active=FALSE')
    expect(inactive.items.map((i) => i.mandate.id)).toEqual([seed.mandates.aeroBreached.id])
    expect((await list('?active=&pool=')).items).toHaveLength(2)
  })

  it('rejects a bad active flag with 400', async () => {
    const res = await app.request('/api/mm?active=maybe')
    expect(res.status).toBe(400)
    const body = (await res.json()) as ErrorResponse
    expect(body.error).toMatch(/^invalid query: active: /)
    expect(body.issues?.map((i) => i.path)).toEqual(['active'])
  })

  it('is empty without mandates', async () => {
    for (const id of Object.values(seed.mandates).map((m) => m.id)) db.mandates.delete(id)
    expect(await list()).toEqual({ items: [] })
  })
})

describe('GET /api/mm/:id', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  it('returns the summary plus the pool summary', async () => {
    const mandate = seed.mandates.slipstreamOk
    const res = await app.request(`/api/mm/${mandate.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ScorecardDetail
    expect(body.mandate).toEqual(toPublicMandate(mandate))
    expect(body.status).toBe('ok')
    expect(body.pool?.pool.id).toBe(seed.pools.wethAeroSlip.id)
    expect(body.pool?.health).toEqual({ total: 70, grade: 'B', rated: true, unratedReason: null })
    expect(body.pool?.depth2Usd).toBe(400_000)
    expect(body.latest?.blockNumber).toBe('20000000')
    expect(body.latest?.timestamp).toBe(seed.now)
  })

  it('has a null pool when the mandated pool is not scored or unknown', async () => {
    db.mandates.upsert(fixtureMandate({ id: 'unscored', poolId: seed.pools.usdcDegenV3.id }))
    db.mandates.upsert(fixtureMandate({ id: 'unknown-pool', poolId: 'uniswap-v3:0xnope' }))
    for (const id of ['unscored', 'unknown-pool']) {
      const res = await app.request(`/api/mm/${id}`)
      expect(res.status, id).toBe(200)
      const body = (await res.json()) as ScorecardDetail
      expect(body.pool).toBeNull()
      expect(body.status).toBe('no-data')
      expect(body.latest).toBeNull()
      expect(body.uptime.d7).toEqual({ windowHours: 168, samples: 0, withinKpi: 0, uptime: null })
    }
  })

  it('404s for unknown mandates with the error shape', async () => {
    for (const id of ['nope', 'demo-missing', '0x1']) {
      const res = await app.request(`/api/mm/${id}`)
      expect(res.status, id).toBe(404)
      expect(await res.json()).toEqual({ error: 'mandate not found' })
    }
  })
})

describe('GET /api/mm/:id/samples', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  async function samples(id: string, query = ''): Promise<SamplesResponse> {
    const res = await app.request(`/api/mm/${id}/samples${query}`)
    expect(res.status).toBe(200)
    return (await res.json()) as SamplesResponse
  }

  it('defaults to 7 d ending now, ascending, jsonified', async () => {
    const id = seed.mandates.slipstreamOk.id
    const body = await samples(id)
    expect(body.window).toBe('7d')
    expect(body.to).toBe(seed.now)
    expect(body.from).toBe(seed.now - 7 * DAY)
    const expected = (seed.mmSamples.get(id) ?? []).filter((s) => s.timestamp >= body.from)
    expect(body.points).toHaveLength(85)
    expect(body.points).toEqual(expected.map((s) => toJsonSafe(s)))
    for (let i = 1; i < body.points.length; i++) {
      expect(body.points[i]!.timestamp).toBeGreaterThan(body.points[i - 1]!.timestamp)
    }
    expect(body.points[0]?.blockNumber).toMatch(/^\d+$/)
  })

  it.each([
    ['24h', DAY, 13],
    ['7d', 7 * DAY, 85],
    ['30d', 30 * DAY, 97],
  ] as const)('serves the %s window', async (window, seconds, count) => {
    const id = seed.mandates.slipstreamOk.id
    const body = await samples(id, `?window=${window}`)
    expect(body).toMatchObject({ window, from: seed.now - seconds, to: seed.now })
    expect(body.points).toHaveLength(count)
    expect(body.points[0]?.timestamp).toBeGreaterThanOrEqual(body.from)
    expect(body.points.at(-1)?.timestamp).toBe(seed.now)
  })

  it('bounds the window inclusively and never reaches past 30 d or into the future', async () => {
    const mandate = fixtureMandate({ id: 'bounds', poolId: seed.pools.wethUsdcV3.id })
    db.mandates.upsert(mandate)
    const from = seed.now - 30 * DAY
    const stamps = [from - 1, from, from + 1, seed.now - 1, seed.now, seed.now + 1]
    db.mmSamples.insertMany(
      stamps.map((timestamp) =>
        fixtureMmSample({ mandateId: mandate.id, timestamp, blockNumber: BigInt(timestamp) }),
      ),
    )
    const body = await samples(mandate.id, '?window=30d')
    expect(body.points.map((p) => p.timestamp)).toEqual([from, from + 1, seed.now - 1, seed.now])
    const day = await samples(mandate.id, '?window=24h')
    expect(day.points.map((p) => p.timestamp)).toEqual([seed.now - 1, seed.now])
  })

  it('keeps the newest `limit` samples of the window', async () => {
    const id = seed.mandates.slipstreamOk.id
    const all = await samples(id, '?window=30d')
    const body = await samples(id, '?window=30d&limit=5')
    expect(body.points).toHaveLength(5)
    expect(body.points).toEqual(all.points.slice(-5))
    expect(body.from).toBe(all.from)
    const one = await samples(id, '?limit=1')
    expect(one.points.map((p) => p.timestamp)).toEqual([seed.now])
    expect((await samples(id, '?limit=10000')).points).toHaveLength(85)
  })

  it('is empty for a mandate without samples in the window', async () => {
    db.mandates.upsert(fixtureMandate({ id: 'quiet', poolId: seed.pools.wethUsdcV3.id }))
    const body = await samples('quiet')
    expect(body).toEqual({ window: '7d', from: seed.now - 7 * DAY, to: seed.now, points: [] })
  })

  it.each(['?window=1h', '?window=90d', '?limit=0', '?limit=10001', '?limit=ten', '?limit=1.5'])(
    'rejects %s with 400',
    async (query) => {
      const res = await app.request(`/api/mm/${seed.mandates.slipstreamOk.id}/samples${query}`)
      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toMatch(/^invalid query: /)
      expect(body.issues?.length).toBeGreaterThan(0)
    },
  )

  it('treats empty parameters as defaults and 404s unknown mandates', async () => {
    const id = seed.mandates.aeroBreached.id
    expect(await samples(id, '?window=&limit=')).toEqual(await samples(id))
    const missing = await app.request('/api/mm/nope/samples')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'mandate not found' })
    // Validation comes before the lookup, as for the pools history route.
    expect((await app.request('/api/mm/nope/samples?window=x')).status).toBe(400)
  })
})

describe('GET /api/mm/:id/badge.svg', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  it('serves an SVG with the cache header', async () => {
    const res = await app.request(`/api/mm/${seed.mandates.slipstreamOk.id}/badge.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('cache-control')).toBe(BADGE_CACHE_CONTROL)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    const svg = await res.text()
    expect(svg).toContain('<svg')
    expect(svg).toContain('depthwatch')
  })

  it('shows the status and the 7 d uptime in the status colour', async () => {
    const ok = seed.mandates.slipstreamOk
    const okSamples = (seed.mmSamples.get(ok.id) ?? []).filter(
      (s) => s.timestamp >= seed.now - 30 * DAY,
    )
    const d7 = computeUptime(okSamples, 168, seed.now).uptime ?? 0
    const pct = Math.round(d7 * 1000) / 10
    const okSvg = await (await app.request(`/api/mm/${ok.id}/badge.svg`)).text()
    expect(okSvg).toContain(`>ok · 7d ${pct}%</text>`)
    expect(okSvg).toContain(`fill="${BADGE_COLOURS.ok}"`)

    const badSvg = await (
      await app.request(`/api/mm/${seed.mandates.aeroBreached.id}/badge.svg`)
    ).text()
    expect(badSvg).toContain('>breached · 7d 24%</text>')
    expect(badSvg).toContain(`fill="${BADGE_COLOURS.breached}"`)

    db.mandates.upsert(fixtureMandate({ id: 'empty-one', poolId: 'x' }))
    const greySvg = await (await app.request('/api/mm/empty-one/badge.svg')).text()
    expect(greySvg).toContain('>no-data · 7d n/a</text>')
    expect(greySvg).toContain(`fill="${BADGE_COLOURS['no-data']}"`)
  })

  it('answers a matching If-None-Match with 304 and serves one summary per mandate', async () => {
    const path = `/api/mm/${seed.mandates.slipstreamOk.id}/badge.svg`
    const first = await app.request(path)
    const tag = first.headers.get('etag')
    expect(tag).toMatch(/^"/)
    const again = await app.request(path, { headers: { 'if-none-match': tag ?? '' } })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    expect(again.headers.get('etag')).toBe(tag)
    // The list, the detail and the badge read the same summary; a new sample changes all three.
    const list = (await (await app.request('/api/mm')).json()) as ScorecardsResponse
    const ok = list.items.find((i) => i.mandate.id === seed.mandates.slipstreamOk.id)
    expect(ok?.status).toBe('ok')
    db.mmSamples.insert(
      fixtureMmSample({
        mandateId: seed.mandates.slipstreamOk.id,
        poolId: seed.pools.wethAeroSlip.id,
        timestamp: seed.now,
        withinKpi: false,
        breaches: ['spread'],
      }),
    )
    const changed = await app.request(path, { headers: { 'if-none-match': tag ?? '' } })
    expect(changed.status).toBe(200)
    expect(await changed.text()).toContain('>breached · 7d')
    const detail = (await (
      await app.request(`/api/mm/${seed.mandates.slipstreamOk.id}`)
    ).json()) as ScorecardDetail
    expect(detail.status).toBe('breached')
    expect(detail.latest?.breaches).toEqual(['spread'])
  })

  it('404s (JSON) for unknown mandates and is readable cross-origin', async () => {
    const missing = await app.request('/api/mm/nope/badge.svg')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toMatch(/application\/json/)
    expect(await missing.json()).toEqual({ error: 'mandate not found' })
    const res = await app.request(`/api/mm/${seed.mandates.slipstreamOk.id}/badge.svg`, {
      headers: { origin: 'https://example.org' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
