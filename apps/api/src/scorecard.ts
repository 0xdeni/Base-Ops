/**
 * Scorecard summaries for the `/api/mm` routes (docs/design/scorecards.md §6): each summary is
 * core's `summarizeScorecard` over the mandate's samples of the last 30 days, so `uptime.d30` is
 * exactly the history the API keeps in view. Reading and parsing a month of samples costs far
 * more than summarising them, so `ScorecardCache` keeps the last summary per mandate and serves
 * it again while nothing it was computed from has changed.
 */
import {
  jsonStringify,
  type Mandate,
  type ScorecardSummary,
  summarizeScorecard,
  toJsonSafe,
  toPublicMandate,
} from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { type ApiContext, DAY_SECONDS } from './context.js'
import type { ScorecardSummaryDto } from './dto.js'

/** How far back a summary reads samples (the longest uptime window). */
export const SUMMARY_WINDOW_SECONDS = 30 * DAY_SECONDS

/** The oldest timestamp (inclusive) a summary computed at `now` reads. */
export function summaryWindowStart(now: number): number {
  return now - SUMMARY_WINDOW_SECONDS
}

/** Seconds a summary is served again while the mandate and its samples are unchanged. */
export const SCORECARD_CACHE_SECONDS = 60

interface CacheEntry {
  /** The mandate as summarised, serialised: a re-registration (from any process) changes it. */
  mandateKey: string
  /** Row id of the mandate's newest sample when summarised; null when it had none. */
  latestSampleId: number | null
  /** `floor(now / SCORECARD_CACHE_SECONDS)`: the uptime windows end at the clock. */
  tick: number
  summary: ScorecardSummary
}

/**
 * One summary per mandate, reused while the mandate, its newest sample (an index lookup) and the
 * clock's minute are the ones it was computed with: a new sample or a re-registration is seen on
 * the next request, a pruned sample or the moving windows within a minute. `delete` forgets a
 * mandate that was removed.
 */
export class ScorecardCache {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(
    private readonly db: Database,
    /** Unix seconds. */
    private readonly now: () => number,
  ) {}

  /** The mandate's scorecard at the clock: `mmSamples.seriesFor(id, now − 30 d)`, summarised. */
  get(mandate: Mandate): ScorecardSummary {
    const now = this.now()
    const tick = Math.floor(now / SCORECARD_CACHE_SECONDS)
    const latestSampleId = this.db.mmSamples.latestIdFor(mandate.id)
    const mandateKey = jsonStringify(mandate)
    const hit = this.entries.get(mandate.id)
    if (
      hit &&
      hit.tick === tick &&
      hit.latestSampleId === latestSampleId &&
      hit.mandateKey === mandateKey
    )
      return hit.summary
    const samples = this.db.mmSamples.seriesFor(mandate.id, summaryWindowStart(now))
    const summary = summarizeScorecard(mandate, samples, now)
    this.entries.set(mandate.id, { mandateKey, latestSampleId, tick, summary })
    return summary
  }

  delete(mandateId: string): void {
    this.entries.delete(mandateId)
  }

  get size(): number {
    return this.entries.size
  }
}

/** The mandate's scorecard at the context's clock, through the context's `ScorecardCache`. */
export function loadScorecard(ctx: ApiContext, mandate: Mandate): ScorecardSummary {
  return ctx.scorecards.get(mandate)
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
