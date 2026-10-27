/**
 * A mandate's alert webhook URL is a bearer secret. The API half of this guarantee is
 * `apps/api/src/routes/webhookSecret.test.ts`; this file covers the rest of the pipeline: the
 * static export bundle (every scorecard section of it) carries no part of the URL, the operator's
 * `mm show` masks it, a failed delivery records and logs it masked, and alert delivery still
 * posts to the URL stored in the database.
 */

import { createApp, createSeededDatabase, type Seed } from '@depthwatch/api'
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import { jsonStringify } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'
import { buildStaticBundle } from './export.js'
import { createLogger } from './log.js'
import { maskedSummary, summaryFor } from './mm.js'
import { deliverAlerts, deliverWebhook, type WebhookFetch } from './pipeline/alerts.js'
import { createPipelineContext, type PipelineContext } from './pipeline/context.js'

const ADMIN_TOKEN = 'test-admin-token'
const CANARY = 'canary-9f3a7c1e5d42b8'
const HOST = 'leak-canary.example.net'
const PATH = '/services/T0CANARY/B0CANARY'
const WEBHOOK_URL = `https://${HOST}${PATH}/${CANARY}?token=${CANARY}`
/** The secret parts of the URL; the host alone is not secret and stays in a masked form. */
const PIECES = [WEBHOOK_URL, CANARY, PATH, encodeURIComponent(WEBHOOK_URL)]

const leaks = (text: string, pieces: readonly string[] = PIECES): string[] =>
  pieces.filter((piece) => text.includes(piece))

describe('the alert webhook URL outside the HTTP API', () => {
  let db: Database
  let seed: Seed
  let mandateId: string
  let lines: string[]
  let ctx: PipelineContext

  beforeEach(async () => {
    ;({ db, seed } = createSeededDatabase())
    mandateId = seed.mandates.aeroBreached.id
    // Registered through the real route: the seeded breached mandate (it has samples), now with a
    // webhook whose URL holds the canary; two breached samples are enough to alert.
    const breached = seed.mandates.aeroBreached
    const app = createApp(db, { now: () => seed.now, adminToken: ADMIN_TOKEN })
    const res = await app.request('/api/mm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({
        id: breached.id,
        name: breached.name,
        poolId: breached.poolId,
        marketMaker: breached.marketMaker,
        addresses: breached.addresses,
        kpis: breached.kpis,
        alertWebhookUrl: WEBHOOK_URL,
        alertAfterSamples: 2,
      }),
    })
    expect(res.status).toBe(201)
    lines = []
    ctx = createPipelineContext({
      db,
      chain: createChainReader({ transport: createFixtureTransport(createFixture()) }),
      config: loadConfig({ DEPTHWATCH_PUBLIC_URL: 'https://depthwatch.example/' }),
      log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
      now: () => seed.now,
    })
  })
  afterEach(() => db.close())

  it('is in the database, which is the control for the checks below', () => {
    expect(db.mandates.get(mandateId)?.alertWebhookUrl).toBe(WEBHOOK_URL)
    expect(leaks(JSON.stringify(db.mandates.get(mandateId)))).toContain(CANARY)
  })

  it('is absent from the static export bundle, which still says a webhook is set', async () => {
    const bundle = await buildStaticBundle(db, { now: seed.now, source: 'live' })
    // Nothing public carries any part of it, the host included.
    expect(leaks(JSON.stringify(bundle), [...PIECES, HOST])).toEqual([])
    const flags = bundle.scorecards.map((s) => [s.mandate.id, s.mandate.alertWebhookConfigured])
    expect(flags).toContainEqual([mandateId, true])
    expect(bundle.scorecardDetails[mandateId]?.mandate.alertWebhookConfigured).toBe(true)
    for (const section of [bundle.scorecards, bundle.scorecardDetails]) {
      expect(JSON.stringify(section)).not.toContain('alertWebhookUrl')
    }
  })

  it('is masked to scheme and host in what `mm show` prints', () => {
    const mandate = db.mandates.get(mandateId)
    if (!mandate) throw new Error('mandate missing')
    const printed = jsonStringify(maskedSummary(summaryFor(db, mandate, seed.now)), 2)
    expect(leaks(printed, [CANARY, PATH, 'token='])).toEqual([])
    expect(printed).toContain(`"alertWebhookUrl": "https://${HOST}/…"`)
  })

  it('is still the URL alert delivery posts to', async () => {
    const mandate = db.mandates.get(mandateId)
    if (!mandate) throw new Error('mandate missing')
    const posted: string[] = []
    const fetch: WebhookFetch = async (url) => {
      posted.push(url)
      return { ok: true, status: 200 }
    }
    const result = await deliverAlerts(ctx, [mandate], { fetch })
    expect(result).toMatchObject({ mandates: 1, attempts: 1, delivered: 1 })
    expect(posted).toEqual([WEBHOOK_URL])
    // What is recorded and logged about the alert never carries the URL.
    expect(leaks(JSON.stringify(db.mmAlerts.latestFor(mandateId)))).toEqual([])
    expect(leaks(lines.join('\n'))).toEqual([])
  })

  it('is masked in the error of a failed delivery, in the record and in the log', async () => {
    const mandate = db.mandates.get(mandateId)
    if (!mandate) throw new Error('mandate missing')
    const failing: WebhookFetch = async (url) => {
      throw new TypeError(`Failed to parse URL from ${url}`)
    }
    const result = await deliverAlerts(ctx, [mandate], { fetch: failing })
    expect(result).toMatchObject({ attempts: 1, delivered: 0 })
    const recorded = db.mmAlerts.latestFor(mandateId)
    expect(recorded?.delivered).toBe(false)
    // The CLI cuts every URL in an error to its origin (log.ts `errorMessage`).
    expect(recorded?.error).toContain(`https://${HOST}`)
    expect(leaks(JSON.stringify(recorded))).toEqual([])
    expect(lines.some((line) => line.includes('alert not delivered'))).toBe(true)
    expect(leaks(lines.join('\n'))).toEqual([])
  })

  it('deliverWebhook masks the URL in an error and posts to the URL it is given', async () => {
    const seen: string[] = []
    const outcome = await deliverWebhook(
      WEBHOOK_URL,
      { event: 'breach' },
      {
        fetch: async (url) => {
          seen.push(url)
          throw new Error(`connect ECONNREFUSED ${url}`)
        },
      },
    )
    expect(seen).toEqual([WEBHOOK_URL])
    expect(outcome.delivered).toBe(false)
    expect(leaks(outcome.error ?? '')).toEqual([])
  })
})
