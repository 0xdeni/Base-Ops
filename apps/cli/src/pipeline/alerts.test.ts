/**
 * Webhook alerts against a receiver on 127.0.0.1: a breach is posted once the streak reaches
 * `alertAfterSamples` (and only once per streak), a single within-KPI sample posts `recovered`,
 * a non-2xx answer, an unreachable host and a timeout are recorded as undelivered attempts, and
 * nothing ever throws into the pipeline.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import type { Mandate, MmSample } from '@depthwatch/core'
import {
  type Database,
  fixtureAttribution,
  fixtureMandate,
  fixtureMmAlert,
  fixtureMmSample,
  fixturePool,
  IN_MEMORY,
  openDatabase,
} from '@depthwatch/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import {
  ALERT_USER_AGENT,
  alertedForStreak,
  buildAlertPayload,
  decideAlert,
  deliverAlerts,
  deliverWebhook,
  type WebhookFetch,
} from './alerts.js'
import { createPipelineContext, type PipelineContext } from './context.js'

const T0 = 1_700_000_000
const BLOCK = 50_000_000n

interface Received {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}

/** A webhook receiver: records every POST and answers with the configured status. */
function startReceiver(): Promise<{
  server: Server
  url: string
  received: Received[]
  status: { code: number }
}> {
  const received: Received[] = []
  const status = { code: 200 }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      })
      res.writeHead(status.code, { 'content-type': 'text/plain' })
      res.end('ok')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}/hook`, received, status })
    })
  })
}

/** A sample at block `timestamp` unless given one: a mandate has one sample per block. */
const at = (overrides: Partial<MmSample>): MmSample =>
  fixtureMmSample({ blockNumber: BigInt(overrides.timestamp ?? T0), ...overrides })

function breached(overrides: Partial<MmSample> = {}): MmSample {
  return at({
    withinKpi: false,
    breaches: ['depthDown'],
    attribution: fixtureAttribution({ depthDownUsd: 12_000 }),
    ...overrides,
  })
}

function within(overrides: Partial<MmSample> = {}): MmSample {
  return at({ withinKpi: true, breaches: [], ...overrides })
}

describe('decideAlert', () => {
  const mandate = fixtureMandate({ alertAfterSamples: 3, alertWebhookUrl: 'http://h/x' })
  const series = (flags: Array<boolean | null>): MmSample[] =>
    flags.map((flag, i) =>
      flag === null
        ? fixtureMmSample({ withinKpi: null, breaches: [], timestamp: T0 + i })
        : flag
          ? within({ timestamp: T0 + i })
          : breached({ timestamp: T0 + i }),
    )

  it('needs alertAfterSamples consecutive breached samples', () => {
    expect(decideAlert(mandate, [], undefined)).toBeNull()
    expect(decideAlert(mandate, series([false, false]), undefined)).toBeNull()
    expect(decideAlert(mandate, series([true, false, false]), undefined)).toBeNull()
    const decision = decideAlert(mandate, series([true, false, false, false]), undefined)
    expect(decision?.kind).toBe('breach')
    expect(decision?.streak).toEqual({ breached: true, samples: 3, since: T0 + 1 })
    expect(decision?.latest.timestamp).toBe(T0 + 3)
  })

  it('does not repeat a breach already alerted for the same streak', () => {
    const samples = series([true, false, false, false])
    const alerted = fixtureMmAlert({ kind: 'breach', timestamp: T0 + 3 })
    expect(decideAlert(mandate, samples, alerted)).toBeNull()
    // The window slides: a streak longer than the window is the alerted one.
    const long = series([false, false, false, false])
    const old = fixtureMmAlert({ kind: 'breach', timestamp: T0 - 100 })
    expect(decideAlert(mandate, long, old)).toBeNull()
    expect(alertedForStreak(old, { breached: true, samples: 4, since: T0 }, long, 3)).toBe(true)
    // A breach alert from before this streak started (no recovery recorded) is not this streak's.
    expect(decideAlert(mandate, samples, old)?.kind).toBe('breach')
    expect(decideAlert(mandate, samples, fixtureMmAlert({ kind: 'recovered' }))?.kind).toBe(
      'breach',
    )
  })

  it('recovers after one within-KPI sample following a breach alert, and only then', () => {
    const alerted = fixtureMmAlert({ kind: 'breach', timestamp: T0 + 2 })
    const decision = decideAlert(mandate, series([false, false, false, true]), alerted)
    expect(decision?.kind).toBe('recovered')
    expect(decision?.streak).toEqual({ breached: false, samples: 1, since: T0 + 3 })
    expect(decideAlert(mandate, series([false, false, false, true]), undefined)).toBeNull()
    expect(decideAlert(mandate, series([false, false, false, null]), alerted)).toBeNull()
    const recovered = fixtureMmAlert({ kind: 'recovered', timestamp: T0 + 3 })
    expect(decideAlert(mandate, series([false, false, true, true]), recovered)).toBeNull()
  })

  it('ignores unevaluable samples when walking the streak', () => {
    expect(decideAlert(mandate, series([false, null, false, false]), undefined)?.kind).toBe(
      'breach',
    )
  })

  it('does not repeat a breach when an unevaluable sample takes a slot of the window', () => {
    const at = (flag: boolean | null, i: number): MmSample =>
      flag === null
        ? fixtureMmSample({ withinKpi: null, breaches: [], timestamp: T0 + i })
        : flag
          ? within({ timestamp: T0 + i })
          : breached({ timestamp: T0 + i })
    // Alerted at T0 + 2 (F0 F1 F2); the streak goes on through an unevaluable sample.
    const alerted = fixtureMmAlert({ kind: 'breach', timestamp: T0 + 2 })
    const window = [at(false, 3), at(false, 4), at(null, 5), at(false, 6)]
    expect(decideAlert(mandate, window, alerted)).toBeNull()
    expect(
      alertedForStreak(alerted, { breached: true, samples: 3, since: T0 + 3 }, window, 3),
    ).toBe(true)
    const single = fixtureMandate({ alertAfterSamples: 1, alertWebhookUrl: 'http://h/x' })
    const alertedAtStart = fixtureMmAlert({ kind: 'breach', timestamp: T0 })
    expect(decideAlert(single, [at(null, 1), at(false, 2)], alertedAtStart)).toBeNull()
    // A within-KPI sample in the window still pins the streak's start: an older alert is not its.
    expect(
      decideAlert(mandate, [at(true, 3), at(false, 4), at(false, 5), at(false, 6)], alerted)?.kind,
    ).toBe('breach')
    // A window that is not full holds every sample: the streak's start is known.
    expect(decideAlert(single, [at(false, 2)], alertedAtStart)?.kind).toBe('breach')
  })
})

describe('buildAlertPayload', () => {
  it('carries the latest sample with the block as a decimal string', () => {
    const mandate = fixtureMandate()
    const latest = breached({ blockNumber: 2n ** 70n, timestamp: T0 })
    const payload = buildAlertPayload(
      mandate,
      { kind: 'breach', latest, streak: { breached: true, samples: 3, since: T0 - 600 } },
      'http://localhost:8787/mm/demo-weth-usdc',
    )
    expect(payload).toEqual({
      event: 'breach',
      mandateId: mandate.id,
      name: mandate.name,
      poolId: mandate.poolId,
      timestamp: T0,
      blockNumber: (2n ** 70n).toString(),
      streakSamples: 3,
      breaches: ['depthDown'],
      attribution: latest.attribution,
      scorecardUrl: 'http://localhost:8787/mm/demo-weth-usdc',
    })
    expect(() => JSON.stringify(payload)).not.toThrow()
  })
})

describe('deliverAlerts against a local webhook', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>
  let db: Database
  let ctx: PipelineContext
  let lines: string[]
  let mandate: Mandate

  beforeAll(async () => {
    receiver = await startReceiver()
  })
  afterAll(() => new Promise<void>((resolve) => receiver.server.close(() => resolve())))

  beforeEach(() => {
    receiver.received.length = 0
    receiver.status.code = 200
    lines = []
    db = openDatabase(IN_MEMORY, { now: () => T0 })
    const chain = createChainReader({ transport: createFixtureTransport(createFixture()) })
    ctx = createPipelineContext({
      db,
      chain,
      config: loadConfig({ DEPTHWATCH_PUBLIC_URL: 'https://depthwatch.example/' }),
      log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
      now: () => T0,
    })
    db.pools.upsertMany([fixturePool()])
    mandate = fixtureMandate({ alertWebhookUrl: receiver.url, alertAfterSamples: 2 })
    db.mandates.upsert(mandate)
  })
  afterEach(() => db.close())

  const addSample = (sample: MmSample) => db.mmSamples.insert({ ...sample, mandateId: mandate.id })

  it('posts a breach after N consecutive breached samples, once per streak, then recovered', async () => {
    addSample(breached({ timestamp: T0, blockNumber: BLOCK }))
    expect(await deliverAlerts(ctx, [mandate])).toMatchObject({
      mandates: 1,
      attempts: 0,
      delivered: 0,
    })
    expect(receiver.received).toHaveLength(0)

    addSample(breached({ timestamp: T0 + 300, blockNumber: BLOCK + 150n }))
    const second = await deliverAlerts(ctx, [mandate])
    expect(second).toMatchObject({ mandates: 1, attempts: 1, delivered: 1 })
    expect(receiver.received).toHaveLength(1)
    const [post] = receiver.received
    expect(post?.path).toBe('/hook')
    expect(post?.headers['content-type']).toBe('application/json')
    expect(post?.headers['user-agent']).toBe(ALERT_USER_AGENT)
    expect(post?.body).toMatchObject({
      event: 'breach',
      mandateId: mandate.id,
      name: mandate.name,
      poolId: mandate.poolId,
      timestamp: T0 + 300,
      blockNumber: (BLOCK + 150n).toString(),
      streakSamples: 2,
      breaches: ['depthDown'],
      scorecardUrl: `https://depthwatch.example/mm/${mandate.id}`,
    })
    expect((post?.body.attribution as { depthDownUsd: number } | undefined)?.depthDownUsd).toBe(
      12_000,
    )
    const recorded = db.mmAlerts.latestFor(mandate.id)
    expect(recorded).toMatchObject({
      kind: 'breach',
      timestamp: T0 + 300,
      streakSamples: 2,
      delivered: true,
      responseStatus: 200,
      error: null,
    })
    expect(recorded?.payload.blockNumber).toBe((BLOCK + 150n).toString())
    expect(lines.some((l) => l.includes('alert delivered') && l.includes('event=breach'))).toBe(
      true,
    )

    // The streak goes on: no second breach alert.
    addSample(breached({ timestamp: T0 + 600 }))
    addSample(breached({ timestamp: T0 + 900 }))
    expect((await deliverAlerts(ctx, [mandate])).attempts).toBe(0)
    expect(receiver.received).toHaveLength(1)
    expect(db.mmAlerts.countFor(mandate.id)).toBe(1)

    // One within-KPI sample: recovered.
    addSample(within({ timestamp: T0 + 1200, blockNumber: BLOCK + 600n }))
    expect(await deliverAlerts(ctx, [mandate])).toMatchObject({ attempts: 1, delivered: 1 })
    expect(receiver.received).toHaveLength(2)
    expect(receiver.received[1]?.body).toMatchObject({
      event: 'recovered',
      streakSamples: 1,
      breaches: [],
      timestamp: T0 + 1200,
    })
    expect(db.mmAlerts.latestFor(mandate.id)?.kind).toBe('recovered')
    expect((await deliverAlerts(ctx, [mandate])).attempts).toBe(0)

    // A new streak alerts again.
    addSample(breached({ timestamp: T0 + 1500 }))
    addSample(breached({ timestamp: T0 + 1800 }))
    expect((await deliverAlerts(ctx, [mandate])).attempts).toBe(1)
    expect(receiver.received[2]?.body).toMatchObject({ event: 'breach', streakSamples: 2 })
    expect(db.mmAlerts.listFor(mandate.id, 10).map((a) => a.kind)).toEqual([
      'breach',
      'recovered',
      'breach',
    ])
  })

  it('posts one breach per streak when unevaluable samples sit in the window', async () => {
    const gappy = fixtureMandate({
      id: 'gappy',
      alertWebhookUrl: receiver.url,
      alertAfterSamples: 3,
    })
    db.mandates.upsert(gappy)
    const posted: string[] = []
    const recording: WebhookFetch = async (_url, init) => {
      posted.push(String((JSON.parse(init.body) as { event: unknown }).event))
      return { ok: true, status: 200 }
    }
    const step = async (sample: MmSample) => {
      db.mmSamples.insert({ ...sample, mandateId: gappy.id })
      await deliverAlerts(ctx, [gappy], { fetch: recording })
    }
    const unevaluable = (i: number) => at({ withinKpi: null, breaches: [], timestamp: T0 + i })
    for (const i of [0, 1, 2]) await step(breached({ timestamp: T0 + i }))
    expect(posted).toEqual(['breach'])
    await step(breached({ timestamp: T0 + 3 }))
    await step(breached({ timestamp: T0 + 4 }))
    await step(unevaluable(5))
    await step(breached({ timestamp: T0 + 6 }))
    await step(breached({ timestamp: T0 + 7 }))
    await step(unevaluable(8))
    await step(unevaluable(9))
    await step(breached({ timestamp: T0 + 10 }))
    expect(posted).toEqual(['breach'])
    expect(db.mmAlerts.countFor(gappy.id)).toBe(1)
    await step(within({ timestamp: T0 + 11 }))
    expect(posted).toEqual(['breach', 'recovered'])
    expect(db.mmAlerts.listFor(gappy.id, 10).map((a) => [a.kind, a.timestamp])).toEqual([
      ['recovered', T0 + 11],
      ['breach', T0 + 2],
    ])
  })

  it('records a non-2xx answer as undelivered with the status', async () => {
    receiver.status.code = 503
    addSample(breached({ timestamp: T0 }))
    addSample(breached({ timestamp: T0 + 300 }))
    const result = await deliverAlerts(ctx, [mandate])
    expect(result).toMatchObject({ attempts: 1, delivered: 0 })
    expect(receiver.received).toHaveLength(1)
    expect(db.mmAlerts.latestFor(mandate.id)).toMatchObject({
      kind: 'breach',
      delivered: false,
      responseStatus: 503,
      error: 'webhook answered HTTP 503',
    })
    expect(lines.some((l) => l.includes('alert not delivered') && l.includes('status=503'))).toBe(
      true,
    )
    // Not retried: the attempt stands as this streak's alert.
    expect((await deliverAlerts(ctx, [mandate])).attempts).toBe(0)
  })

  it('records a connection failure with its error and never throws', async () => {
    const closed = await startReceiver()
    await new Promise<void>((resolve) => closed.server.close(() => resolve()))
    const unreachable = fixtureMandate({
      id: 'unreachable',
      alertWebhookUrl: closed.url,
      alertAfterSamples: 1,
    })
    db.mandates.upsert(unreachable)
    db.mmSamples.insert(breached({ mandateId: unreachable.id, timestamp: T0 }))
    const result = await deliverAlerts(ctx, [unreachable])
    expect(result).toMatchObject({ mandates: 1, attempts: 1, delivered: 0 })
    const recorded = db.mmAlerts.latestFor(unreachable.id)
    expect(recorded?.delivered).toBe(false)
    expect(recorded?.responseStatus).toBeNull()
    expect(recorded?.error).toMatch(/ECONNREFUSED|fetch failed|connect/i)
  })

  it('times out through the injected fetch and records the timeout', async () => {
    const hanging: WebhookFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      })
    addSample(breached({ timestamp: T0 }))
    addSample(breached({ timestamp: T0 + 300 }))
    const result = await deliverAlerts(ctx, [mandate], { fetch: hanging, timeoutMs: 20 })
    expect(result).toMatchObject({ attempts: 1, delivered: 0 })
    expect(db.mmAlerts.latestFor(mandate.id)).toMatchObject({
      delivered: false,
      responseStatus: null,
    })
    expect(db.mmAlerts.latestFor(mandate.id)?.error).toMatch(/timeout|timed out|aborted/i)
  })

  it('skips mandates without a webhook and survives a broken fetch', async () => {
    const quiet = fixtureMandate({ id: 'quiet', alertWebhookUrl: null, alertAfterSamples: 1 })
    db.mandates.upsert(quiet)
    db.mmSamples.insert(breached({ mandateId: quiet.id, timestamp: T0 }))
    addSample(breached({ timestamp: T0 }))
    addSample(breached({ timestamp: T0 + 300 }))
    const exploding: WebhookFetch = () => {
      throw new Error('boom')
    }
    const result = await deliverAlerts(ctx, [quiet, mandate], { fetch: exploding })
    expect(result).toMatchObject({ mandates: 1, attempts: 1, delivered: 0 })
    expect(db.mmAlerts.countFor(quiet.id)).toBe(0)
    expect(db.mmAlerts.latestFor(mandate.id)?.error).toBe('boom')
  })

  it('deliverWebhook reports a thrown request as an outcome', async () => {
    const outcome = await deliverWebhook('http://127.0.0.1:1/x', { a: 1 }, { timeoutMs: 1_000 })
    expect(outcome.delivered).toBe(false)
    expect(outcome.responseStatus).toBeNull()
    expect(outcome.error).toBeTruthy()
  })
})
