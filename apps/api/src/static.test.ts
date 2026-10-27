import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { isApiPath, staticDirExists, wantsSpaFallback } from './static.js'
import { createSeededDatabase } from './testing/seed.js'

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>'
const APP_JS = 'console.log("depthwatch")'
const STYLE_CSS = ':root{--bg:#fff}'

describe('static serving', () => {
  let dir: string
  let db: Database
  let app: Hono

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-api-static-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), INDEX_HTML)
    writeFileSync(join(dir, 'assets', 'app.js'), APP_JS)
    writeFileSync(join(dir, 'assets', 'style.css'), STYLE_CSS)
    writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(dir, 'secret.json'), '{"secret":true}')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  beforeEach(() => {
    db = createSeededDatabase().db
    app = createApp(db, { staticDir: dir })
  })
  afterEach(() => db.close())

  it('serves files with their content types', async () => {
    const js = await app.request('/assets/app.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await js.text()).toBe(APP_JS)

    const css = await app.request('/assets/style.css')
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await css.text()).toBe(STYLE_CSS)

    const svg = await app.request('/favicon.svg')
    expect(svg.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')

    const json = await app.request('/secret.json')
    expect(json.headers.get('content-type')).toBe('application/json')
  })

  it('serves index.html at the root', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe(INDEX_HTML)
  })

  it('falls back to index.html for client-side routes', async () => {
    for (const path of ['/pools', '/pools/uniswap-v3:0x1', '/gaps', '/tokens/0xabc', '/deep/er']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(await res.text()).toBe(INDEX_HTML)
    }
  })

  it('answers HEAD for the fallback and for files', async () => {
    const head = await app.request('/pools/x', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const file = await app.request('/assets/app.js', { method: 'HEAD' })
    expect(file.status).toBe(200)
    expect(file.headers.get('content-length')).toBe(String(APP_JS.length))
  })

  it('keeps /api JSON: routes still work and unknown API paths are JSON 404', async () => {
    const health = await app.request('/api/health')
    expect(health.headers.get('content-type')).toMatch(/application\/json/)
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true)
    const missing = await app.request('/api/nope', { headers: { accept: 'text/html' } })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not found' })
  })

  it('404s missing assets unless the client navigates (accepts HTML)', async () => {
    const asset = await app.request('/assets/missing.js', { headers: { accept: '*/*' } })
    expect(asset.status).toBe(404)
    expect(await asset.json()).toEqual({ error: 'not found' })
    const navigation = await app.request('/weird.page', {
      headers: { accept: 'text/html,application/xhtml+xml' },
    })
    expect(navigation.status).toBe(200)
    expect(await navigation.text()).toBe(INDEX_HTML)
  })

  it('never serves outside the static dir', async () => {
    for (const path of ['/../package.json', '/assets/../../package.json', '/%2e%2e/package.json']) {
      const res = await app.request(path)
      const text = await res.text()
      expect(text, path).not.toContain('"name"')
      expect([200, 404]).toContain(res.status)
      if (res.status === 200) expect(text).toBe(INDEX_HTML)
    }
  })

  it('does not serve files for writes', async () => {
    const res = await app.request('/assets/app.js', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('ignores a missing static dir', async () => {
    const without = createApp(db, { staticDir: join(dir, 'does-not-exist') })
    const res = await without.request('/')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})

describe('helpers', () => {
  it('isApiPath', () => {
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/api/pools')).toBe(true)
    expect(isApiPath('/apiary')).toBe(false)
    expect(isApiPath('/')).toBe(false)
  })

  it('wantsSpaFallback', () => {
    expect(wantsSpaFallback('/pools/uniswap-v3:0x1', undefined)).toBe(true)
    expect(wantsSpaFallback('/assets/x.js', '*/*')).toBe(false)
    expect(wantsSpaFallback('/assets/x.js', undefined)).toBe(false)
    expect(wantsSpaFallback('/x.y', 'text/html')).toBe(true)
  })

  it('staticDirExists', () => {
    expect(staticDirExists(tmpdir())).toBe(true)
    expect(staticDirExists(join(tmpdir(), `depthwatch-nope-${Date.now()}`))).toBe(false)
    expect(staticDirExists(new URL(import.meta.url).pathname)).toBe(false) // a file, not a dir
  })
})
