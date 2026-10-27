/**
 * Scorecard summaries for the `/api/mm` routes (docs/design/scorecards.md §6): each summary is
 * computed on request with core's `summarizeScorecard` over the mandate's samples of the last
 * 30 days, so `uptime.d30` is exactly the history the API keeps in view.
 */
import {
  type Mandate,
  type ScorecardSummary,
  summarizeScorecard,
  toJsonSafe,
  toPublicMandate,
} from '@depthwatch/core'
import { type ApiContext, DAY_SECONDS } from './context.js'
import type { ScorecardSummaryDto } from './dto.js'

/** How far back a summary reads samples (the longest uptime window). */
export const SUMMARY_WINDOW_SECONDS = 30 * DAY_SECONDS

/** The oldest timestamp (inclusive) a summary computed at `now` reads. */
export function summaryWindowStart(now: number): number {
  return now - SUMMARY_WINDOW_SECONDS
}

/** The mandate's scorecard at the context's clock: `mmSamples.seriesFor(id, now − 30 d)`. */
export function loadScorecard(ctx: ApiContext, mandate: Mandate): ScorecardSummary {
  const now = ctx.now()
  const samples = ctx.db.mmSamples.seriesFor(mandate.id, summaryWindowStart(now))
  return summarizeScorecard(mandate, samples, now)
}

/**
 * The wire shape: bigints (block numbers in samples and excursions) as decimal strings, and the
 * mandate in its public view, so the alert webhook URL (a bearer secret) never leaves the database.
 */
export function toScorecardDto(summary: ScorecardSummary): ScorecardSummaryDto {
  return toJsonSafe({ ...summary, mandate: toPublicMandate(summary.mandate) })
}

function compareText(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** List order of `GET /api/mm`: active mandates first, then by name, then by id. */
export function compareScorecards(a: ScorecardSummary, b: ScorecardSummary): number {
  if (a.mandate.active !== b.mandate.active) return a.mandate.active ? -1 : 1
  return compareText(a.mandate.name, b.mandate.name) || compareText(a.mandate.id, b.mandate.id)
}

export function sortScorecards(summaries: readonly ScorecardSummary[]): ScorecardSummary[] {
  return [...summaries].sort(compareScorecards)
}
