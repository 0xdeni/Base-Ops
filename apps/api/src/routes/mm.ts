import { type Mandate, MandateValidationError, parseMandate, toJsonSafe } from '@depthwatch/core'
import { Hono, type MiddlewareHandler } from 'hono'
import { checkAdminAuth } from '../auth.js'
import { BADGE_CACHE_CONTROL, BADGE_CONTENT_TYPE, renderBadge } from '../badge.js'
import { type ApiContext, DAY_SECONDS } from '../context.js'
import type {
  DeleteMandateResponse,
  ErrorResponse,
  SamplesResponse,
  SampleWindow,
  ScorecardDetail,
  ScorecardsResponse,
} from '../dto.js'
import { parseQuery, samplesQuerySchema, scorecardsQuerySchema } from '../query.js'
import { loadScorecard, sortScorecards, toScorecardDto } from '../scorecard.js'
import { toPoolSummary } from '../summary.js'

const WINDOW_SECONDS: Readonly<Record<SampleWindow, number>> = Object.freeze({
  '24h': DAY_SECONDS,
  '7d': 7 * DAY_SECONDS,
  '30d': 30 * DAY_SECONDS,
})

const MANDATE_NOT_FOUND: ErrorResponse = { error: 'mandate not found' }
const REGISTRATION_DISABLED: ErrorResponse = { error: 'registration disabled' }
const UNAUTHORIZED: ErrorResponse = { error: 'unauthorized' }
const INVALID_JSON: ErrorResponse = { error: 'invalid JSON body' }

/** The field a `parseMandate` problem names ("kpis.minDepthUsd must be …"), or `(body)`. */
const PROBLEM_FIELD_RE =
  /^(id|name|poolId|marketMaker|addresses(?:\[\d+\])?|kpis(?:\.\w+)?|alertWebhookUrl|alertAfterSamples|active|createdAt|notes) must /

function problemPath(message: string): string {
  return PROBLEM_FIELD_RE.exec(message)?.[1] ?? '(body)'
}

function validationError(error: MandateValidationError): ErrorResponse {
  return {
    error: error.message,
    issues: error.problems.map((message) => ({ path: problemPath(message), message })),
  }
}

function hasOwnCreatedAt(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).createdAt !== undefined
  )
}

/**
 * `GET /api/mm`, `GET /api/mm/:id`, `GET /api/mm/:id/samples`, `GET /api/mm/:id/badge.svg`,
 * `POST /api/mm` and `DELETE /api/mm/:id` (docs/design/scorecards.md §6).
 *
 * Mandate ids are slugs, so they never clash with the `badge.svg` / `samples` sub-paths. The two
 * write routes require `Authorization: Bearer <adminToken>`: 403 `registration disabled` when
 * no token is configured, 401 for a missing or wrong one.
 */
export function mmRoutes(ctx: ApiContext): Hono {
  const app = new Hono()

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    const check = checkAdminAuth(ctx.adminToken, c.req.header('authorization'))
    if (check === 'disabled') return c.json(REGISTRATION_DISABLED, 403)
    if (check === 'unauthorized') {
      c.header('WWW-Authenticate', 'Bearer realm="depthwatch"')
      return c.json(UNAUTHORIZED, 401)
    }
    await next()
  }

  app.get('/', (c) => {
    const parsed = parseQuery(scorecardsQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const q = parsed.data
    const mandates = ctx.db.mandates.list({ active: q.active, poolId: q.pool })
    const summaries = sortScorecards(mandates.map((mandate) => loadScorecard(ctx, mandate)))
    const body: ScorecardsResponse = { items: summaries.map(toScorecardDto) }
    return c.json(body)
  })

  app.get('/:id', (c) => {
    const mandate = ctx.db.mandates.get(c.req.param('id'))
    if (!mandate) return c.json(MANDATE_NOT_FOUND, 404)
    const row = ctx.db.scores.getRow(mandate.poolId)
    const body: ScorecardDetail = {
      ...toScorecardDto(loadScorecard(ctx, mandate)),
      pool: row ? toPoolSummary(row) : null,
    }
    return c.json(body)
  })

  app.get('/:id/samples', (c) => {
    const parsed = parseQuery(samplesQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const id = c.req.param('id')
    if (!ctx.db.mandates.get(id)) return c.json(MANDATE_NOT_FOUND, 404)
    const { window, limit } = parsed.data
    const to = ctx.now()
    const from = to - WINDOW_SECONDS[window]
    const series = ctx.db.mmSamples.seriesFor(id, from, to)
    // Ascending series; when it overflows the limit the newest samples are the ones that matter.
    const points = series.length > limit ? series.slice(series.length - limit) : series
    const body: SamplesResponse = {
      window,
      from,
      to,
      points: points.map((sample) => toJsonSafe(sample)),
    }
    return c.json(body)
  })

  app.get('/:id/badge.svg', (c) => {
    const mandate = ctx.db.mandates.get(c.req.param('id'))
    if (!mandate) return c.json(MANDATE_NOT_FOUND, 404)
    const svg = renderBadge(loadScorecard(ctx, mandate))
    return c.body(svg, 200, {
      'Content-Type': BADGE_CONTENT_TYPE,
      'Cache-Control': BADGE_CACHE_CONTROL,
    })
  })

  app.post('/', requireAdmin, async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(INVALID_JSON, 400)
    }
    let mandate: Mandate
    try {
      mandate = parseMandate(body, ctx.now())
    } catch (error) {
      if (error instanceof MandateValidationError) return c.json(validationError(error), 400)
      throw error
    }
    // Re-registering an id corrects the mandate in place; its registration time survives unless
    // the body sets one, like its samples and alerts do.
    const existing = ctx.db.mandates.get(mandate.id)
    if (existing && !hasOwnCreatedAt(body)) mandate = { ...mandate, createdAt: existing.createdAt }
    ctx.db.mandates.upsert(mandate)
    return c.json(toScorecardDto(loadScorecard(ctx, mandate)), 201)
  })

  app.delete('/:id', requireAdmin, (c) => {
    const id = c.req.param('id')
    const removed = ctx.db.transaction(() => {
      if (!ctx.db.mandates.delete(id)) return undefined
      return {
        samplesDeleted: ctx.db.mmSamples.deleteFor(id),
        alertsDeleted: ctx.db.mmAlerts.deleteFor(id),
      }
    })
    if (!removed) return c.json(MANDATE_NOT_FOUND, 404)
    ctx.scorecards.delete(id)
    const body: DeleteMandateResponse = { id, deleted: true, ...removed }
    return c.json(body)
  })

  return app
}
