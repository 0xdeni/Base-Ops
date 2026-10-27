import { toJsonSafe } from '@depthwatch/core'
import { Hono } from 'hono'
import { type ApiContext, DAY_SECONDS } from '../context.js'
import type {
  ErrorResponse,
  HistoryResponse,
  HistoryWindow,
  PoolDetail,
  PoolsResponse,
} from '../dto.js'
import { buildHistoryPoints, HEALTH_PERSISTENCE_SECONDS } from '../history.js'
import { historyQuerySchema, parseQuery, poolsQuerySchema } from '../query.js'
import { toPoolSummary } from '../summary.js'

const WINDOW_SECONDS: Readonly<Record<HistoryWindow, number>> = Object.freeze({
  '24h': DAY_SECONDS,
  '7d': 7 * DAY_SECONDS,
})

const POOL_NOT_FOUND: ErrorResponse = { error: 'pool not found' }

/**
 * `GET /api/pools`, `GET /api/pools/:id`, `GET /api/pools/:id/history`.
 * Pool ids contain a colon (`uniswap-v3:0x…`); Hono matches them as one segment.
 */
export function poolsRoutes(ctx: ApiContext): Hono {
  const app = new Hono()

  app.get('/', (c) => {
    const parsed = parseQuery(poolsQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const q = parsed.data
    const result = ctx.db.scores.topBy(q.sort, {
      dir: q.dir,
      dex: q.dex,
      q: q.q,
      minVolumeUsd: q.minVolume,
      rated: q.rated,
      limit: q.limit,
      offset: q.offset,
    })
    const body: PoolsResponse = { items: result.items.map(toPoolSummary), total: result.total }
    return c.json(body)
  })

  app.get('/:id', (c) => {
    const id = c.req.param('id')
    const record = ctx.db.pools.getRecord(id)
    if (!record) return c.json(POOL_NOT_FOUND, 404)
    const score = ctx.db.scores.get(id)
    const latest = ctx.db.snapshots.latestForPool(id)
    const body: PoolDetail = {
      pool: toJsonSafe(record.pool),
      tracked: record.tracked,
      latest: latest ? toJsonSafe(latest) : null,
      score: score?.health ?? null,
      gap: score?.gap ?? null,
      persistence24h: score?.persistence24h ?? null,
      persistence7d: score?.persistence7d ?? null,
      // Core's 24 h volume as the score step summed it; never re-derived here (docs/METRICS.md).
      volume24hUsd: score ? score.volume24hUsd : null,
      scoredAt: score?.timestamp ?? null,
    }
    return c.json(body)
  })

  app.get('/:id/history', (c) => {
    const parsed = parseQuery(historyQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const id = c.req.param('id')
    if (!ctx.db.pools.get(id)) return c.json(POOL_NOT_FOUND, 404)
    const window = parsed.data.window
    // The window ends at the pool's newest snapshot so a paused indexer still yields a chart.
    const to = ctx.db.snapshots.latestForPool(id)?.timestamp ?? ctx.now()
    const from = to - WINDOW_SECONDS[window]
    // One persistence window of lead-in so the first points' health sees its trailing samples.
    const series = ctx.db.snapshots.seriesForPool(id, from - HEALTH_PERSISTENCE_SECONDS, to)
    const body: HistoryResponse = { window, from, to, points: buildHistoryPoints(series, from) }
    return c.json(body)
  })

  return app
}
