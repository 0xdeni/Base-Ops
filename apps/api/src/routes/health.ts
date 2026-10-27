import { Hono } from 'hono'
import { type ApiContext, errorMessage } from '../context.js'
import type { HealthResponse } from '../dto.js'

/** `GET /api/health`: never throws; 503 with `ok: false` when the database cannot be read. */
export function healthRoutes(ctx: ApiContext): Hono {
  const app = new Hono()
  app.get('/', (c) => {
    try {
      const body: HealthResponse = {
        ok: true,
        poolCount: ctx.db.pools.count(),
        trackedCount: ctx.db.pools.count({ tracked: true }),
        latestSnapshotAt: ctx.db.snapshots.latestTimestamp(),
        latestBlock: ctx.db.snapshots.latestBlock()?.toString() ?? null,
        source: ctx.source,
      }
      return c.json(body)
    } catch (error) {
      const body: HealthResponse = {
        ok: false,
        poolCount: 0,
        trackedCount: 0,
        latestSnapshotAt: null,
        latestBlock: null,
        source: ctx.source,
        error: errorMessage(error),
      }
      return c.json(body, 503)
    }
  })
  return app
}
