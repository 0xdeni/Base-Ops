/**
 * `createApp(db, opts?)` builds the Hono application: `/api` routes with CORS for reads, the
 * agent documents (`/AGENTS.md`, `/llms.txt`, `/openapi.json`, see `routes/agentDocs.ts`), JSON
 * errors everywhere (404 for unknown routes, 400 for bad queries, 500 for bugs) and, when
 * `opts.staticDir` exists, the built dashboard with an SPA fallback. `opts.adminToken` unlocks
 * mandate registration over the API (`POST /api/mm`, `DELETE /api/mm/:id`). Responses are
 * compressed, tagged and given their `Cache-Control` by `caching.ts`.
 */
import type { Database } from '@depthwatch/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { apiCacheControl, compressAndTag } from './caching.js'
import type { ApiContext } from './context.js'
import type { DataSource, ErrorResponse } from './dto.js'
import { agentDocsRoutes } from './routes/agentDocs.js'
import { createApiRouter } from './routes/index.js'
import { ScorecardCache } from './scorecard.js'
import { mountStatic, staticDirExists } from './static.js'

export interface CreateAppOptions {
  /** Directory of the built dashboard. Ignored (with no error) when it does not exist. */
  staticDir?: string
  /** Clock in unix seconds; defaults to the wall clock. */
  now?: () => number
  /** Receives unexpected handler errors; defaults to `console.error`. */
  onError?: (error: unknown, path: string) => void
  /**
   * Bearer token required by `POST /api/mm` and `DELETE /api/mm/:id` (`DEPTHWATCH_ADMIN_TOKEN`
   * in the CLI). Unset or empty, those routes answer 403 `registration disabled`.
   */
  adminToken?: string
  /**
   * What the database holds, reported by `GET /api/health` as `source`: `demo` for the synthetic
   * demo world (`depthwatch demo`, `export --demo`). Defaults to `live`.
   */
  source?: DataSource
}

const NOT_FOUND: ErrorResponse = { error: 'not found' }
const INTERNAL: ErrorResponse = { error: 'internal error' }

export function createApp(db: Database, opts: CreateAppOptions = {}): Hono {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const ctx: ApiContext = {
    db,
    now,
    scorecards: new ScorecardCache(db, now),
    adminToken: opts.adminToken,
    source: opts.source ?? 'live',
  }
  const report = opts.onError ?? ((error, path) => console.error(`api: ${path}`, error))
  const app = new Hono()

  app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'OPTIONS'], maxAge: 600 }))
  app.use('/api/*', ...compressAndTag(), apiCacheControl())
  app.route('/api', createApiRouter(ctx))
  // Before the static dashboard, so its SPA fallback never answers for these documents.
  app.route('/', agentDocsRoutes())

  app.notFound((c) => c.json(NOT_FOUND, 404))
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const body: ErrorResponse = { error: error.message || `HTTP ${error.status}` }
      return c.json(body, error.status)
    }
    report(error, c.req.path)
    return c.json(INTERNAL, 500)
  })

  if (opts.staticDir !== undefined && staticDirExists(opts.staticDir)) {
    mountStatic(app, opts.staticDir)
  }
  return app
}
