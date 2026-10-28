/**
 * Alerts under the daily retention prune, over a breach streak longer than MM_ALERTS_DAYS: the
 * streak's delivered breach outlives the prune, so the streak gets one breach however long it
 * lasts, and its recovery is still sent. The webhook is a stub that records each event.
 */
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import {
  type Database,
  fixtureAttribution,
  fixtureMandate,
  fixtureMmSample,
  fixturePool,
  IN_MEMORY,
  openDatabase,
} from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { type AlertOptions, deliverAlerts } from './alerts.js'
import { createPipelineContext, DAY_SECONDS } from './context.js'
import { MM_ALERTS_DAYS, pruneDue, pruneStep } from './prune.js'

const T0 = 1_700_000_000

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

describe('alerts across the retention prune', () => {
  it('sends one breach for a streak longer than MM_ALERTS_DAYS, then its recovery', async () => {
    let clock = T0
    const db = openDatabase(IN_MEMORY, { now: () => clock })
    dbs.push(db)
    const ctx = createPipelineContext({
      db,
      chain: createChainReader({ transport: createFixtureTransport(createFixture()) }),
      config: loadConfig({}),
      log: createLogger({ write: () => undefined, now: () => new Date(0) }),
      now: () => clock,
    })
    db.pools.upsertMany([fixturePool()])
    const mandate = fixtureMandate({
      alertWebhookUrl: 'https://hooks.example.com/depthwatch',
      alertAfterSamples: 2,
    })
    db.mandates.upsert(mandate)
    const events: string[] = []
    const webhook: AlertOptions = {
      fetch: async (_url, init) => {
        events.push((JSON.parse(init.body) as { event: string }).event)
        return { ok: true, status: 200 }
      },
    }
    /** One sample at `clock`, the alert check and, when due, the prune, as `start` runs them. */
    const pass = async (withinKpi: boolean) => {
      db.mmSamples.insert(
        fixtureMmSample({
          mandateId: mandate.id,
          blockNumber: BigInt(clock),
          timestamp: clock,
          withinKpi,
          breaches: withinKpi ? [] : ['depthDown'],
          attribution: fixtureAttribution({ depthDownUsd: withinKpi ? 50_000 : 100 }),
        }),
      )
      await deliverAlerts(ctx, [mandate], webhook)
      if (pruneDue(db, clock)) await pruneStep(ctx)
    }

    await pass(true)
    for (let day = 0; day <= MM_ALERTS_DAYS + 10; day++) {
      clock = T0 + 300 + day * DAY_SECONDS
      await pass(false)
    }
    expect(events).toEqual(['breach'])
    // The breach went out at the streak's second sample. It is older than the alert retention
    // and kept; nothing else is.
    const breachAt = T0 + 300 + DAY_SECONDS
    expect(clock - breachAt).toBeGreaterThan(MM_ALERTS_DAYS * DAY_SECONDS)
    expect(db.mmAlerts.listFor(mandate.id, 10).map((a) => [a.kind, a.timestamp])).toEqual([
      ['breach', breachAt],
    ])

    clock += DAY_SECONDS
    await pass(true)
    expect(events).toEqual(['breach', 'recovered'])
  })
})
