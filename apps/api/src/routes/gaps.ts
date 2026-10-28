import { DEFAULT_GAP_MIN_VOLUME_USD } from '@depthwatch/db'
import { Hono } from 'hono'
import type { ApiContext } from '../context.js'
import type { GapsResponse } from '../dto.js'
import { gapsQuerySchema, parseQuery } from '../query.js'
import { toGapItem } from '../summary.js'

/**
 * `GET /api/gaps`: pools with real volume on thin depth, best gap score first, with the whole feed's
 * `total` and `meaningful` counts (docs/METRICS.md, "Gap score and the gaps feed").
 */
export function gapsRoutes(ctx: ApiContext): Hono {
  const app = new Hono()
  app.get('/', (c) => {
    const parsed = parseQuery(gapsQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const q = parsed.data
    const minVolumeUsd = q.minVolume ?? DEFAULT_GAP_MIN_VOLUME_USD
    const rows = ctx.db.scores.gaps({ limit: q.limit, offset: q.offset, minVolumeUsd })
    const { total, meaningful } = ctx.db.scores.gapCounts(minVolumeUsd)
    const shared = ctx.db.tokens.sharedSymbols()
    const items = rows.map((row) => toGapItem(row, shared))
    const body: GapsResponse = { items, total, meaningful, minVolumeUsd }
    return c.json(body)
  })
  return app
}
