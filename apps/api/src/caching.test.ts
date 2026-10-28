/**
 * Compression, ETag and Cache-Control on `/api/*` (caching.ts): a body is gzip-compressed only
 * when the client accepts it, a matching If-None-Match gets a bodiless 304 that keeps the cache
 * header, and each kind of route carries the Cache-Control DESIGN.md gives it.
 */
import { gunzipSync } from 'node:zlib'
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { BADGE_CACHE_CONTROL } from './badge.js'
import { API_CACHE_CONTROL, staticCacheControl } from './caching.js'
import { createSeededDatabase, SEED_MM_OK_ID, type Seed } from './testing/seed.js'

const GZIP = { 'accept-encoding': 'gzip, deflate, br' }

describe('/api responses', () => {
  let db: Database
  let seed: Seed
  let app: Hono

  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now })
  })
  afterEach(() => db.close())

  it('are gzip-compressed when the client accepts it, identical to the plain body', async () => {
    const plain = await app.request('/api/pools')
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(plain.headers.get('vary')).toBe('Accept-Encoding')
    const text = await plain.text()

    const zipped = await app.request('/api/pools', { headers: GZIP })
    expect(zipped.status).toBe(200)
    expect(zipped.headers.get('content-encoding')).toBe('gzip')
    expect(zipped.headers.get('content-type')).toMatch(/application\/json/)
    const raw = Buffer.from(await zipped.arrayBuffer())
    expect(raw.length).toBeLessThan(text.length)
    expect(gunzipSync(raw).toString('utf8')).toBe(text)
  })

  it('carry an ETag and answer a matching If-None-Match with a bodiless 304', async () => {
    const first = await app.request('/api/stats')
    const tag = first.headers.get('etag')
    expect(tag).toMatch(/^"[0-9a-f]{40}"$/)
    const again = await app.request('/api/stats', { headers: { 'if-none-match': tag ?? '' } })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    expect(again.headers.get('cache-control')).toBe(API_CACHE_CONTROL)
    expect(again.headers.get('etag')).toBe(tag)

    // The compressed form carries the same tag, weakened, so either form revalidates the other.
    const zipped = await app.request('/api/stats', { headers: GZIP })
    expect(zipped.headers.get('etag')).toBe(`W/${tag}`)
    const viaWeak = await app.request('/api/stats', {
      headers: { ...GZIP, 'if-none-match': `W/${tag}` },
    })
    expect(viaWeak.status).toBe(304)
  })

  it('tag changes with the body', async () => {
    const a = (await app.request('/api/pools?limit=1')).headers.get('etag')
    const b = (await app.request('/api/pools?limit=2')).headers.get('etag')
    expect(a).not.toBe(b)
  })

  it('carry Cache-Control per route: 30 s for reads, the badge its own, health none', async () => {
    const cases: Array<[string, string | null]> = [
      ['/api/pools', API_CACHE_CONTROL],
      ['/api/stats', API_CACHE_CONTROL],
      [`/api/pools/${seed.pools.wethUsdcV3.id}`, API_CACHE_CONTROL],
      ['/api/mm', API_CACHE_CONTROL],
      [`/api/mm/${SEED_MM_OK_ID}/badge.svg`, BADGE_CACHE_CONTROL],
      ['/api/health', null],
      ['/api/health?maxAge=1', null],
    ]
    for (const [path, expected] of cases) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('cache-control'), path).toBe(expected)
    }
    expect(BADGE_CACHE_CONTROL).not.toBe(API_CACHE_CONTROL)
  })

  it('give HEAD the same Cache-Control as GET', async () => {
    const res = await app.request('/api/pools', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(API_CACHE_CONTROL)
  })

  it('never make an error or a write cacheable', async () => {
    const missing = await app.request('/api/pools/uniswap-v3:0xmissing')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBeNull()
    const bad = await app.request('/api/pools?limit=0')
    expect(bad.status).toBe(400)
    expect(bad.headers.get('cache-control')).toBeNull()
    const write = await app.request('/api/mm', { method: 'POST', body: '{}' })
    expect(write.status).toBe(403)
    expect(write.headers.get('cache-control')).toBeNull()
  })
})

describe('staticCacheControl', () => {
  it('is immutable for a year under /assets/ and no-cache elsewhere', () => {
    expect(staticCacheControl('/assets/index-1gtripqj.js')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(staticCacheControl('/assets/style.css')).toBe('public, max-age=31536000, immutable')
    for (const path of ['/', '/index.html', '/pools/x', '/favicon.svg', '/assets', '/xassets/a.js'])
      expect(staticCacheControl(path), path).toBe('no-cache')
  })

  it('is no-cache for the SPA fallback answered under /assets/', () => {
    expect(staticCacheControl('/assets/app-old.js', 'text/html; charset=UTF-8')).toBe('no-cache')
    expect(staticCacheControl('/assets/app.js', 'text/javascript; charset=utf-8')).toBe(
      'public, max-age=31536000, immutable',
    )
  })
})
