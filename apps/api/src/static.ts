/**
 * Static serving of the built dashboard (`apps/web/dist`) with an SPA fallback.
 *
 * Files are served by `@hono/node-server`'s serveStatic (streams, content types from the
 * extension, `..` segments rejected). A GET that matches no file and no `/api` route gets
 * `index.html`, unless it looks like a file request (`/assets/missing.js`) from a client that does
 * not accept HTML, which is a plain 404 so broken asset links do not come back as HTML.
 */
import { statSync } from 'node:fs'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context, Hono } from 'hono'

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/')
}

export function staticDirExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/** Whether an unmatched GET should receive `index.html` instead of a 404. */
export function wantsSpaFallback(path: string, accept: string | undefined): boolean {
  const last = path.split('/').pop() ?? ''
  const looksLikeFile = last.includes('.')
  return !looksLikeFile || (accept ?? '').includes('text/html')
}

/** Registers the asset middleware and the SPA fallback on `app`. Call after the API routes. */
export function mountStatic(app: Hono, staticDir: string): void {
  const files = serveStatic({ root: staticDir })
  const index = serveStatic({ root: staticDir, path: 'index.html' })

  app.use('*', async (c: Context, next) => {
    if (isApiPath(c.req.path) || !isReadMethod(c.req.method)) return next()
    return files(c, next)
  })

  app.get('*', async (c: Context, next) => {
    if (isApiPath(c.req.path) || !wantsSpaFallback(c.req.path, c.req.header('accept'))) {
      return next()
    }
    return index(c, next)
  })
}
