import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
        latestBlock: '20000000',
        source: 'live',
      })
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
          latestBlock: null,
          source: 'live',
        })
      } finally {
        empty.close()
      }
    })

    it('never throws: a broken database yields ok=false with 503', async () => {
      db.close()
      const res = await app.request('/api/health')
      expect(res.status).toBe(503)
      const body = (await res.json()) as HealthResponse
      expect(body.ok).toBe(false)
      expect(body.poolCount).toBe(0)
      expect(body.latestBlock).toBeNull()
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
