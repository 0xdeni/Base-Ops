/**
 * Alert delivery across passes, against receivers on 127.0.0.1: an undelivered breach is tried
 * again at the following samples of its streak until it is delivered or MAX_ALERT_ATTEMPTS
 * attempts were recorded, a recovery is only sent for a delivered breach (and tried again the
 * same way), and a receiver that redirects is a failed delivery whose target never hears from the
 * indexer.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import type { Mandate } from '@depthwatch/core'
import {
  type Database,
  fixtureAttribution,
  fixtureMandate,
  fixtureMmSample,
  fixturePool,
  IN_MEMORY,
  openDatabase,
} from '@depthwatch/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { deliverAlerts, deliverWebhook, MAX_ALERT_ATTEMPTS } from './alerts.js'
import { createPipelineContext, type PipelineContext } from './context.js'

const T0 = 1_700_000_000

interface Receiver {
  server: Server
  url: string
  /** The `event` of every body received, in order. */
  events: string[]
  /** The status answered; with a `location`, a redirect there. */
  answer: { code: number; location: string | null }
}

function startReceiver(): Promise<Receiver> {
  const events: string[] = []
  const answer: Receiver['answer'] = { code: 200, location: null }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      events.push((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { event: string }).event)
      res.writeHead(answer.code, answer.location === null ? {} : { location: answer.location })
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}/hook`, events, answer })
    })
  })
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))

describe('alert delivery across passes', () => {
  let receiver: Receiver
  let db: Database
  let ctx: PipelineContext
  let mandate: Mandate
  let clock: number

  beforeAll(async () => {
    receiver = await startReceiver()
  })
  afterAll(() => close(receiver.server))

  beforeEach(() => {
    receiver.events.length = 0
    receiver.answer.code = 200
    receiver.answer.location = null
    db = openDatabase(IN_MEMORY, { now: () => T0 })
    const chain = createChainReader({ transport: createFixtureTransport(createFixture()) })
    ctx = createPipelineContext({
      db,
      chain,
      config: loadConfig({}),
      log: createLogger({ write: () => undefined, now: () => new Date(0) }),
      now: () => T0,
    })
    db.pools.upsertMany([fixturePool()])
    mandate = fixtureMandate({ alertWebhookUrl: receiver.url, alertAfterSamples: 2 })
    db.mandates.upsert(mandate)
    clock = T0
  })
  afterEach(() => db.close())

  /** One pass: stores the next sample (5 min later) and runs the alert check, as the pipeline does. */
  const pass = async (withinKpi: boolean) => {
    clock += 300
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
    return deliverAlerts(ctx, [mandate])
  }
  const recorded = () =>
    db.mmAlerts
      .listFor(mandate.id, 20)
      .reverse()
      .map((a) => `${a.kind}:${a.delivered}`)

  it('delivers a breach at a later sample of the streak once the receiver is back', async () => {
    receiver.answer.code = 503
    await pass(false)
    expect(await pass(false)).toMatchObject({ attempts: 1, delivered: 0 })
    expect(await pass(false)).toMatchObject({ attempts: 1, delivered: 0 })
    receiver.answer.code = 200
    expect(await pass(false)).toMatchObject({ attempts: 1, delivered: 1 })
    expect(receiver.events).toEqual(['breach', 'breach', 'breach'])
    // Delivered: the streak is alerted, however long it goes on.
    expect(await pass(false)).toMatchObject({ attempts: 0 })
    expect(recorded()).toEqual(['breach:false', 'breach:false', 'breach:true'])
    // The recovery pairs with the delivered breach.
    expect(await pass(true)).toMatchObject({ attempts: 1, delivered: 1 })
    expect(receiver.events.at(-1)).toBe('recovered')
  })

  it('stops after MAX_ALERT_ATTEMPTS undelivered breach attempts for one streak', async () => {
    receiver.answer.code = 503
    await pass(false)
    for (let i = 0; i < MAX_ALERT_ATTEMPTS; i++) expect((await pass(false)).attempts).toBe(1)
    receiver.answer.code = 200
    expect((await pass(false)).attempts).toBe(0)
    expect(receiver.events).toHaveLength(MAX_ALERT_ATTEMPTS)
    expect(db.mmAlerts.countAttempts(mandate.id, 'breach')).toBe(MAX_ALERT_ATTEMPTS)
    // Nothing was delivered: no recovery; the next streak starts its own count.
    expect((await pass(true)).attempts).toBe(0)
    await pass(false)
    expect(await pass(false)).toMatchObject({ attempts: 1, delivered: 1 })
    expect(receiver.events).toHaveLength(MAX_ALERT_ATTEMPTS + 1)
    expect(receiver.events.at(-1)).toBe('breach')
  })

  it('sends no recovery for a breach that was never delivered', async () => {
    receiver.answer.code = 503
    await pass(false)
    await pass(false)
    receiver.answer.code = 200
    expect(await pass(true)).toMatchObject({ attempts: 0 })
    expect(receiver.events).toEqual(['breach'])
    expect(recorded()).toEqual(['breach:false'])
  })

  it('tries an undelivered recovery again, at most MAX_ALERT_ATTEMPTS times', async () => {
    await pass(false)
    expect(await pass(false)).toMatchObject({ delivered: 1 })
    receiver.answer.code = 503
    for (let i = 0; i < 2; i++)
      expect(await pass(true)).toMatchObject({ attempts: 1, delivered: 0 })
    receiver.answer.code = 200
    expect(await pass(true)).toMatchObject({ attempts: 1, delivered: 1 })
    expect(await pass(true)).toMatchObject({ attempts: 0 })
    expect(receiver.events).toEqual(['breach', 'recovered', 'recovered', 'recovered'])
    // The cap: MAX_ALERT_ATTEMPTS failed recoveries of one delivered breach end the attempts.
    await pass(false)
    expect(await pass(false)).toMatchObject({ delivered: 1 })
    receiver.answer.code = 503
    for (let i = 0; i < MAX_ALERT_ATTEMPTS; i++) expect((await pass(true)).attempts).toBe(1)
    receiver.answer.code = 200
    expect((await pass(true)).attempts).toBe(0)
    expect(db.mmAlerts.countAttempts(mandate.id, 'recovered')).toBe(MAX_ALERT_ATTEMPTS + 3)
  })
})

describe('deliverWebhook and redirects', () => {
  it('does not follow a redirect: the target receives nothing and the delivery fails', async () => {
    const target = await startReceiver()
    const front = await startReceiver()
    try {
      front.answer.code = 307
      front.answer.location = target.url
      const outcome = await deliverWebhook(front.url, { event: 'breach' }, { timeoutMs: 2_000 })
      expect(outcome).toEqual({
        delivered: false,
        responseStatus: 307,
        error: 'webhook redirected (HTTP 307); redirects are not followed',
      })
      expect(front.events).toEqual(['breach'])
      expect(target.events).toEqual([])
      front.answer.code = 302
      const again = await deliverWebhook(front.url, { event: 'breach' }, { timeoutMs: 2_000 })
      expect(again).toMatchObject({ delivered: false, responseStatus: 302 })
      expect(target.events).toEqual([])
    } finally {
      await close(front.server)
      await close(target.server)
    }
  })

  it('asks for manual redirects and cancels the response body it does not read', async () => {
    let cancelled = 0
    const outcome = await deliverWebhook(
      'https://hooks.example/x',
      { a: 1 },
      {
        fetch: async (_url, init) => {
          expect(init.redirect).toBe('manual')
          return {
            ok: true,
            status: 200,
            body: {
              cancel: async () => {
                cancelled++
              },
            },
          }
        },
      },
    )
    expect(outcome).toEqual({ delivered: true, responseStatus: 200, error: null })
    expect(cancelled).toBe(1)
  })
})
