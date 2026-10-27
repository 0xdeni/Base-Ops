/**
 * Compression and cache headers (DESIGN.md "API (apps/api)"). Every response is gzip- or
 * deflate-compressed when the client accepts it (hono's `compress`) and carries an `ETag` that
 * answers a matching `If-None-Match` with a bodiless 304 (hono's `etag`), on `/api/*` and on
 * the dashboard files alike. `Cache-Control` says how long a copy may be reused: 30 s for API
 * reads (pool data change at the pipeline's cadence, minutes apart), 60 s for a pool's history
 * (the most expensive read, which changes at the same cadence), never stated for `/api/health`
 * (a probe must see the server as it is), a year for the hashed `/assets/*` build outputs (a new
 * build is a new path) and `no-cache` for `index.html` and the other dashboard files, which
 * clients revalidate by `ETag`.
 */
import type { MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'

/** Successful `GET /api/*` responses that set no `Cache-Control` of their own. */
export const API_CACHE_CONTROL = 'public, max-age=30'
/** `GET /api/pools/:id/history`: a week of points scored per request. */
export const HISTORY_CACHE_CONTROL = 'public, max-age=60'
/** The dashboard's hashed build outputs under `/assets/`. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
/** `index.html` and every other dashboard file: always revalidated. */
export const STATIC_CACHE_CONTROL = 'no-cache'

const HEALTH_PATH = '/api/health'
const ASSETS_PREFIX = '/assets/'

function isRead(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/**
 * `compress()` outside `etag()`: the tag is computed over the uncompressed body, so it is the
 * same whatever the client accepts, and `compress` weakens it (`W/`) when it encodes the body.
 */
export function compressAndTag(): MiddlewareHandler[] {
  return [compress(), etag()]
}

/** Adds `API_CACHE_CONTROL` to a successful read that set none; `/api/health` keeps none. */
export function apiCacheControl(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (!isRead(c.req.method) || c.req.path === HEALTH_PATH || !c.res.ok) return
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', API_CACHE_CONTROL)
  }
}

/** The `Cache-Control` of the dashboard file served for request path `path`. */
export function staticCacheControl(path: string): string {
  return path.startsWith(ASSETS_PREFIX) ? ASSET_CACHE_CONTROL : STATIC_CACHE_CONTROL
}

/** Sets `staticCacheControl` on a successful dashboard response (file or SPA fallback). */
export function staticCacheHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (!isRead(c.req.method) || !c.res.ok) return
    if (!c.res.headers.has('Cache-Control')) {
      c.header('Cache-Control', staticCacheControl(c.req.path))
    }
  }
}
