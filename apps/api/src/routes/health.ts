import { Hono } from 'hono'
import { type ApiContext, errorMessage } from '../context.js'
import type { HealthResponse } from '../dto.js'
import { healthQuerySchema, parseQuery } from '../query.js'

/**
 * `GET /api/health`: never throws. 503 with `ok: false` when the database cannot be read (zero
 * counts) or, with `?maxAge=<seconds>`, when the newest snapshot is missing or older than that
 * (counts filled), so a liveness probe fails on stale data; 400 for an invalid `maxAge`.
 */
export function healthRoutes(ctx: ApiContext): Hono {
  const app = new Hono()
  app.get('/', (c) => {
    const parsed = parseQuery(healthQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    try {
      const latestSnapshotAt = ctx.db.snapshots.latestTimestamp()
      const snapshotAgeSeconds = latestSnapshotAt === null ? null : ctx.now() - latestSnapshotAt
      const body: HealthResponse = {
        ok: true,
        poolCount: ctx.db.pools.count(),
        trackedCount: ctx.db.pools.count({ tracked: true }),
        latestSnapshotAt,
        latestScoredAt: ctx.db.scores.latestTimestamp(),
        snapshotAgeSeconds,
        latestBlock: ctx.db.snapshots.latestBlock()?.toString() ?? null,
        source: ctx.source,
      }
      const stale = staleReason(snapshotAgeSeconds, parsed.data.maxAge)
      if (stale !== undefined) return c.json({ ...body, ok: false, error: stale }, 503)
      return c.json(body)
    } catch (error) {
      const body: HealthResponse = {
        ok: false,
        poolCount: 0,
        trackedCount: 0,
        latestSnapshotAt: null,
        latestScoredAt: null,
        snapshotAgeSeconds: null,
        latestBlock: null,
        source: ctx.source,
        error: errorMessage(error),
      }
      return c.json(body, 503)
    }
  })
  return app
}

/** Why the data fail the `maxAge` check; undefined without a check or when they pass it. */
function staleReason(ageSeconds: number | null, maxAge: number | undefined): string | undefined {
  if (maxAge === undefined) return undefined
  if (ageSeconds === null) return 'stale: no snapshot yet'
  return ageSeconds > maxAge ? `stale: newest snapshot is ${ageSeconds} s old` : undefined
}
