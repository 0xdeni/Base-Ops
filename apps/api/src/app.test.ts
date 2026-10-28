import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RequestLogEntry } from './accessLog.js'
import { createApp } from './app.js'
import type { ErrorResponse, HealthResponse } from './dto.js'
import { createSeededDatabase, type Seed } from './testing/seed.js'

describe('createApp', () => {
  let db: Database
  let seed: Seed
  let app: Hono

  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  describe('GET /api/health', () => {
    it('reports counts and the newest snapshot', async () => {
      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      const body = (await res.json()) as HealthResponse
      expect(body).toEqual({
        ok: true,
        poolCount: 7,
        trackedCount: 6,
        latestSnapshotAt: seed.now,
        snapshotAgeSeconds: 0,
        latestBlock: '20000000',
        source: 'live',
      })
    })

    it('ages the newest snapshot by the server clock', async () => {
      const later = createApp(db, { now: () => seed.now + 1234 })
      const body = (await (await later.request('/api/health')).json()) as HealthResponse
      expect(body.snapshotAgeSeconds).toBe(1234)
      expect(body.ok).toBe(true)
    })

    it('reports the demo world as its data source when created with source demo', async () => {
      const res = await createApp(db, { now: () => seed.now, source: 'demo' }).request(
        '/api/health',
      )
      expect(res.status).toBe(200)
      expect(((await res.json()) as HealthResponse).source).toBe('demo')
    })

    it('is empty-safe', async () => {
      const empty = openDatabase(IN_MEMORY)
      try {
        const res = await createApp(empty).request('/api/health')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
          ok: true,
          poolCount: 0,
          trackedCount: 0,
          latestSnapshotAt: null,
          snapshotAgeSeconds: null,
          latestBlock: null,
          source: 'live',
        })
      } finally {
        empty.close()
      }
    })

    describe('?maxAge', () => {
      it('answers 200 while the newest snapshot is at most maxAge seconds old', async () => {
        const exact = createApp(db, { now: () => seed.now + 1800 })
        for (const [server, path] of [
          [app, '/api/health?maxAge=1'],
          [exact, '/api/health?maxAge=1800'],
        ] as const) {
          const res = await server.request(path)
          expect(res.status, path).toBe(200)
          expect(((await res.json()) as HealthResponse).ok).toBe(true)
        }
      })

      it('answers 503 ok=false with the counts when the newest snapshot is older', async () => {
        const stale = createApp(db, { now: () => seed.now + 3600 })
        const res = await stale.request('/api/health?maxAge=1800')
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({
          ok: false,
          poolCount: 7,
          trackedCount: 6,
          latestSnapshotAt: seed.now,
          snapshotAgeSeconds: 3600,
          latestBlock: '20000000',
          source: 'live',
          error: 'stale: newest snapshot is 3600 s old',
        })
      })

      it('answers 503 on an empty database, which has no snapshot to be fresh', async () => {
        const empty = openDatabase(IN_MEMORY)
        try {
          const res = await createApp(empty).request('/api/health?maxAge=1800')
          expect(res.status).toBe(503)
          const body = (await res.json()) as HealthResponse
          expect(body.ok).toBe(false)
          expect(body.snapshotAgeSeconds).toBeNull()
          expect(body.error).toBe('stale: no snapshot yet')
        } finally {
          empty.close()
        }
      })

      it('rejects a maxAge that is not a positive integer with 400', async () => {
        for (const value of ['0', '-5', '1.5', 'soon']) {
          const res = await app.request(`/api/health?maxAge=${value}`)
          expect(res.status, value).toBe(400)
          const body = (await res.json()) as ErrorResponse
          expect(body.error).toMatch(/^invalid query: maxAge: /)
          expect(body.issues?.[0]?.path).toBe('maxAge')
        }
        const empty = await app.request('/api/health?maxAge=')
        expect(empty.status).toBe(200)
      })
    })

    it('never throws: a broken database yields ok=false with 503', async () => {
      db.close()
      const res = await app.request('/api/health')
      expect(res.status).toBe(503)
      const body = (await res.json()) as HealthResponse
      expect(body.ok).toBe(false)
      expect(body.poolCount).toBe(0)
      expect(body.latestBlock).toBeNull()
      expect(body.snapshotAgeSeconds).toBeNull()
      expect(body.source).toBe('live')
      expect(typeof body.error).toBe('string')
    })
  })

  describe('errors', () => {
    it('answers unknown API routes with JSON 404', async () => {
      for (const path of ['/api/nope', '/api/pools/x/y/z', '/api', '/api/']) {
        const res = await app.request(path)
        expect(res.status, path).toBe(404)
        expect(await res.json()).toEqual({ error: 'not found' })
      }
    })

    it('answers non-API paths with JSON 404 when there is no static dir', async () => {
      const res = await app.request('/pools/uniswap-v3:0x1')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not found' })
    })

    it('rejects unsupported methods on API routes with 404', async () => {
      const res = await app.request('/api/pools', { method: 'POST' })
      expect(res.status).toBe(404)
    })

    it('turns handler failures into JSON 500 and reports them', async () => {
      const reported: Array<[unknown, string]> = []
      const failing = createApp(db, { onError: (error, path) => reported.push([error, path]) })
      db.close()
      const res = await failing.request('/api/stats')
      expect(res.status).toBe(500)
      expect((await res.json()) as ErrorResponse).toEqual({ error: 'internal error' })
      expect(reported).toHaveLength(1)
      expect(reported[0]?.[1]).toBe('/api/stats')
    })
  })

  describe('CORS', () => {
    it('allows any origin to read the API', async () => {
      const res = await app.request('/api/health', { headers: { origin: 'https://example.org' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('answers preflight requests for GET', async () => {
      const res = await app.request('/api/pools', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.org',
          'access-control-request-method': 'GET',
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(res.headers.get('access-control-allow-methods')).toBe('GET,HEAD,OPTIONS')
    })
  })

  describe('access log (onRequest)', () => {
    it('reports method, path, status and time of every request, never the query or a header', async () => {
      const entries: RequestLogEntry[] = []
      const logged = createApp(db, { now: () => seed.now, onRequest: (e) => entries.push(e) })
      const secret = 'bearer-value-that-must-not-be-logged'
      const headers = { authorization: `Bearer ${secret}`, cookie: 'session=abc' }
      expect((await logged.request('/api/pools?q=weth&limit=5', { headers })).status).toBe(200)
      expect((await logged.request('/api/nope?x=1')).status).toBe(404)
      expect((await logged.request('/api/health', { method: 'HEAD' })).status).toBe(200)
      expect(entries.map(({ ms: _ms, ...rest }) => rest)).toEqual([
        { method: 'GET', path: '/api/pools', status: 200 },
        { method: 'GET', path: '/api/nope', status: 404 },
        { method: 'HEAD', path: '/api/health', status: 200 },
      ])
      for (const entry of entries) {
        expect(Number.isInteger(entry.ms) && entry.ms >= 0).toBe(true)
        expect(entry.authFailure).toBeUndefined()
      }
      const text = JSON.stringify(entries)
      for (const leak of [secret, 'session', 'weth', '?']) expect(text).not.toContain(leak)
    })

    it('reports a failed handler with its 500', async () => {
      const entries: RequestLogEntry[] = []
      const failing = createApp(db, { onError: () => {}, onRequest: (e) => entries.push(e) })
      db.close()
      expect((await failing.request('/api/stats')).status).toBe(500)
      expect(entries).toMatchObject([{ method: 'GET', path: '/api/stats', status: 500 }])
    })
  })

  it('serialises every bigint as a decimal string', async () => {
    const res = await app.request(`/api/pools/${seed.pools.wethUsdcV3.id}`)
    const text = await res.text()
    expect(res.status).toBe(200)
    const body = JSON.parse(text) as {
      pool: { createdAtBlock: unknown }
      latest: { blockNumber: unknown; activeLiquidity: unknown; depth: Array<{ up: unknown }> }
    }
    expect(body.pool.createdAtBlock).toBe('2000000')
    expect(body.latest.blockNumber).toBe('20000000')
    expect(typeof body.latest.activeLiquidity).toBe('string')
    expect(body.latest.depth[0]?.up).toMatchObject({ amountIn: expect.stringMatching(/^\d+$/) })
  })
})
