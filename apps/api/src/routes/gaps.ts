import { DEFAULT_GAP_MIN_VOLUME_USD } from '@depthwatch/db'
import { Hono } from 'hono'
import type { ApiContext } from '../context.js'
import type { GapsResponse } from '../dto.js'
import { gapsQuerySchema, parseQuery } from '../query.js'
import { toGapItem } from '../summary.js'

/** `GET /api/gaps`: pools with real volume on thin depth, best gap score first. */
export function gapsRoutes(ctx: ApiContext): Hono {
  const app = new Hono()
  app.get('/', (c) => {
    const parsed = parseQuery(gapsQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const q = parsed.data
    const minVolumeUsd = q.minVolume ?? DEFAULT_GAP_MIN_VOLUME_USD
    const rows = ctx.db.scores.gaps({ limit: q.limit, offset: q.offset, minVolumeUsd })
    const body: GapsResponse = { items: rows.map(toGapItem), minVolumeUsd }
    return c.json(body)
  })
  return app
}
