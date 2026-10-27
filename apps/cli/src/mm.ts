/**
 * `depthwatch mm …`: market-maker mandates (docs/design/scorecards.md §5).
 *
 * - `register --file <json>`: `parseMandate` → upsert (an existing id is replaced, its samples and
 *   alerts kept, and its `createdAt` unless the file sets one, as `POST /api/mm` does); prints the
 *   scorecard URL on stdout. A pool the database does not know yet is a
 *   warning, not an error (the API and the demo accept the same): the mandate is sampled from the
 *   first `snapshot` after `discover` finds the pool, as docs/design/scorecards.md §5 asks.
 * - `list`: one line per mandate with its status, active mandates first, then by name.
 * - `show <id>`: the `ScorecardSummary` as JSON (bigints as decimal strings); the alert webhook URL
 *   is printed masked (`https://host/…`), since its path and query are a secret.
 * - `deactivate <id>`: stops sampling; the scorecard stays served as `inactive`.
 * - `sample`: the sampling hook on demand against the latest block (needs an RPC endpoint).
 *
 * Validation and lookup failures are runtime errors (exit 1, one line on stderr); the command
 * line itself is checked in config.ts (exit 2).
 */
import { readFileSync } from 'node:fs'
import {
  jsonStringify,
  type Mandate,
  maskWebhookUrl,
  parseMandate,
  type ScorecardSummary,
  summarizeScorecard,
  UPTIME_WINDOWS_HOURS,
} from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { type Config, type MmArgs, scorecardUrl } from './config.js'
import type { LogFields, Logger } from './log.js'
import { HOUR_SECONDS, type PipelineContext } from './pipeline/context.js'
import { type MmSampleResult, mmSampleStep } from './pipeline/mm.js'

/** Samples the summaries are computed from: the last 30 days, like the API. */
export const SUMMARY_WINDOW_SECONDS = UPTIME_WINDOWS_HOURS.d30 * HOUR_SECONDS

/** The registration JSON of `path`, parsed; a missing or malformed file is a runtime error. */
export function readRegistrationFile(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`cannot read "${path}": ${(error as Error).message}`, { cause: error })
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`"${path}" is not valid JSON: ${(error as Error).message}`, { cause: error })
  }
}

/** Whether a registration sets `createdAt` itself (the same test `POST /api/mm` applies). */
function setsCreatedAt(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as Record<string, unknown>).createdAt !== undefined
  )
}

/**
 * Validates a registration and stores it (an existing id is replaced). Re-registering an id
 * corrects the mandate in place: like its samples and alerts, its registration time survives
 * unless the registration sets `createdAt`, exactly as over `POST /api/mm`. From the next
 * `snapshot` on, the pool is tracked whatever its rank; a pool not in the database yet is skipped
 * by the snapshot until `discover` finds it (`poolIsKnown` tells the caller whether to warn).
 */
export function registerMandate(db: Database, input: unknown, now: number): Mandate {
  const parsed = parseMandate(input, now)
  const existing = db.mandates.get(parsed.id)
  const mandate =
    existing !== undefined && !setsCreatedAt(input)
      ? { ...parsed, createdAt: existing.createdAt }
      : parsed
  db.mandates.upsert(mandate)
  return mandate
}

/** Whether the mandate's pool has been discovered (ids look like `<dex>:<address>`). */
export function poolIsKnown(db: Database, mandate: Pick<Mandate, 'poolId'>): boolean {
  return db.pools.get(mandate.poolId) !== undefined
}

/** The scorecard of one mandate from its samples of the last 30 days. */
export function summaryFor(db: Database, mandate: Mandate, now: number): ScorecardSummary {
  return summarizeScorecard(
    mandate,
    db.mmSamples.seriesFor(mandate.id, now - SUMMARY_WINDOW_SECONDS),
    now,
  )
}

/**
 * The scorecard as the operator's terminal shows it: the webhook URL (a bearer secret: whoever
 * holds it can post through it) is cut to scheme and host, so a pasted `mm show` leaks nothing.
 */
export function maskedSummary(summary: ScorecardSummary): ScorecardSummary {
  const url = summary.mandate.alertWebhookUrl
  if (url === null) return summary
  return { ...summary, mandate: { ...summary.mandate, alertWebhookUrl: maskWebhookUrl(url) } }
}

/** Every mandate's scorecard, active first, then by name (the order the API lists them in). */
export function listSummaries(db: Database, now: number): ScorecardSummary[] {
  return db.mandates
    .list()
    .map((mandate) => summaryFor(db, mandate, now))
    .sort((a, b) => {
      if (a.mandate.active !== b.mandate.active) return a.mandate.active ? -1 : 1
      return (
        a.mandate.name.localeCompare(b.mandate.name) || a.mandate.id.localeCompare(b.mandate.id)
      )
    })
}

function percent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`
}

function isoOrDash(timestamp: number | null): string {
  return timestamp === null ? '-' : new Date(timestamp * 1000).toISOString()
}

/** `mm list` as tab-separated lines with a header: id, status, uptime 24h/7d, last sample, pool, name. */
export function formatMandateList(summaries: readonly ScorecardSummary[]): string[] {
  const header = [
    'id',
    'status',
    'uptime24h',
    'uptime7d',
    'lastSample',
    'pool',
    'marketMaker',
    'name',
  ]
  const rows = summaries.map((s) => [
    s.mandate.id,
    s.status,
    percent(s.uptime.h24.uptime),
    percent(s.uptime.d7.uptime),
    isoOrDash(s.latest?.timestamp ?? null),
    s.mandate.poolId,
    s.mandate.marketMaker,
    s.mandate.name,
  ])
  return [header, ...rows].map((columns) => columns.join('\t'))
}

export function requireMandate(db: Database, id: string): Mandate {
  const mandate = db.mandates.get(id)
  if (mandate === undefined) throw new Error(`unknown mandate "${id}" (see "depthwatch mm list")`)
  return mandate
}

function summarizeSample(result: MmSampleResult): LogFields {
  return {
    mandates: result.mandates,
    pools: result.pools,
    samples: result.samples,
    failed: result.failed.length,
    alerts: result.alerts.attempts,
    delivered: result.alerts.delivered,
  }
}

export interface MmCommandOptions {
  ctx: PipelineContext
  args: MmArgs
  config: Config
  log: Logger
  stdout: (line: string) => void
}

export async function mmCommand(opts: MmCommandOptions): Promise<void> {
  const { ctx, args, config, log, stdout } = opts
  const { db } = ctx
  const now = ctx.now()
  switch (args.subcommand) {
    case 'register': {
      const path = config.mandateFile
      if (path === undefined) throw new Error('mm register needs --file <registration json>')
      const existed = db.mandates.count() // only for the log line below
      const mandate = registerMandate(db, readRegistrationFile(path), now)
      const known = poolIsKnown(db, mandate)
      log.info('mandate registered', {
        mandate: mandate.id,
        pool: mandate.poolId,
        addresses: mandate.addresses.length,
        replaced: db.mandates.count() === existed,
        poolKnown: known,
      })
      if (!known)
        log.warn(
          'mandate pool is not in the database yet; it is sampled once "depthwatch discover" ' +
            'finds it (ids look like <dex>:<address>)',
          { mandate: mandate.id, pool: mandate.poolId },
        )
      stdout(scorecardUrl(config, mandate.id))
      return
    }
    case 'list': {
      for (const line of formatMandateList(listSummaries(db, now))) stdout(line)
      return
    }
    case 'show': {
      const mandate = requireMandate(db, args.id ?? '')
      stdout(jsonStringify(maskedSummary(summaryFor(db, mandate, now)), 2))
      return
    }
    case 'deactivate': {
      const mandate = requireMandate(db, args.id ?? '')
      db.mandates.setActive(mandate.id, false)
      log.info('mandate deactivated', { mandate: mandate.id, pool: mandate.poolId })
      return
    }
    case 'sample': {
      await log.timed('mm sample', (step) => mmSampleStep({ ...ctx, log: step }), summarizeSample)
      return
    }
  }
}
