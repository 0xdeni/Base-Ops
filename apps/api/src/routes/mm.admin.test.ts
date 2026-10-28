import type { PublicMandate } from '@depthwatch/core'
import { type Database, fixtureMmAlert } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RequestLogEntry } from '../accessLog.js'
import { createApp } from '../app.js'
import type {
  DeleteMandateResponse,
  ErrorResponse,
  ScorecardDetail,
  ScorecardSummaryDto,
  ScorecardsResponse,
} from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'

const TOKEN = 'test-admin-token'
/** What `@hono/node-server` hands the app as its environment: the request's socket. */
const PEER = { incoming: { socket: { remoteAddress: '203.0.113.7' } } }

function registration(
  seed: Seed,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'acme-weth-usdc',
    name: 'ACME / WETH-USDC 0.05 %',
    poolId: seed.pools.wethUsdcV3.id,
    marketMaker: 'ACME Markets',
    addresses: ['0xAbCdEf0000000000000000000000000000000001'],
    kpis: { minDepthUsd: 50_000, maxSpreadBps: 30 },
    ...overrides,
  }
}

async function post(app: Hono, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return app.request('/api/mm', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function del(app: Hono, id: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return app.request(`/api/mm/${id}`, { method: 'DELETE', headers })
}

describe('admin auth matrix', () => {
  let db: Database
  let seed: Seed
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
  })
  afterEach(() => db.close())

  it('answers 403 registration disabled without a configured token, even with a bearer', async () => {
    for (const adminToken of [undefined, '']) {
      const app = createApp(db, { now: () => seed.now, adminToken })
      for (const presented of [undefined, TOKEN, 'anything']) {
        const posted = await post(app, registration(seed), presented)
        expect(posted.status, `POST ${adminToken} ${presented}`).toBe(403)
        expect(await posted.json()).toEqual({ error: 'registration disabled' })
        const deleted = await del(app, seed.mandates.aeroBreached.id, presented)
        expect(deleted.status, `DELETE ${adminToken} ${presented}`).toBe(403)
        expect(await deleted.json()).toEqual({ error: 'registration disabled' })
      }
    }
    expect(db.mandates.count()).toBe(2)
  })

  it('answers 401 for a missing, malformed or wrong token', async () => {
    const app = createApp(db, { now: () => seed.now, adminToken: TOKEN })
    const headersList: Array<Record<string, string>> = [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: 'Bearer' },
      { authorization: `Basic ${TOKEN}` },
      { authorization: TOKEN },
      { authorization: `Bearer ${TOKEN.toUpperCase()}` },
    ]
    for (const headers of headersList) {
      const posted = await app.request('/api/mm', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(registration(seed)),
      })
      expect(posted.status, JSON.stringify(headers)).toBe(401)
      expect(posted.headers.get('www-authenticate')).toMatch(/^Bearer/)
      expect(await posted.json()).toEqual({ error: 'unauthorized' })
      const deleted = await app.request(`/api/mm/${seed.mandates.aeroBreached.id}`, {
        method: 'DELETE',
        headers,
      })
      expect(deleted.status, JSON.stringify(headers)).toBe(401)
      expect(await deleted.json()).toEqual({ error: 'unauthorized' })
    }
    expect(db.mandates.count()).toBe(2)
    expect(db.mandates.get('acme-weth-usdc')).toBeUndefined()
  })

  it('reports every 401 to the access log with the reason and the peer address', async () => {
    const entries: RequestLogEntry[] = []
    const app = createApp(db, {
      now: () => seed.now,
      adminToken: TOKEN,
      onRequest: (entry) => entries.push(entry),
    })
    const json = { 'content-type': 'application/json' }
    const body = JSON.stringify(registration(seed))
    const target = `/api/mm/${seed.mandates.aeroBreached.id}`
    await app.request('/api/mm', { method: 'POST', headers: json, body }, PEER)
    await app.request('/api/mm', {
      method: 'POST',
      headers: { ...json, authorization: 'Basic x' },
      body,
    })
    await app.request(
      target,
      { method: 'DELETE', headers: { authorization: 'Bearer guess' } },
      PEER,
    )
    await app.request(
      '/api/mm',
      {
        method: 'POST',
        headers: { ...json, authorization: `Bearer ${TOKEN}` },
        body,
      },
      PEER,
    )
    expect(entries.map(({ ms: _ms, ...rest }) => rest)).toEqual([
      {
        method: 'POST',
        path: '/api/mm',
        status: 401,
        authFailure: 'missing token',
        client: '203.0.113.7',
      },
      // Without a socket (another runtime) the reason is still reported.
      { method: 'POST', path: '/api/mm', status: 401, authFailure: 'missing token' },
      {
        method: 'DELETE',
        path: target,
        status: 401,
        authFailure: 'wrong token',
        client: '203.0.113.7',
      },
      // An accepted request is an ordinary entry: no reason, no peer address.
      { method: 'POST', path: '/api/mm', status: 201 },
    ])
    expect(JSON.stringify(entries)).not.toContain('guess')
    expect(JSON.stringify(entries)).not.toContain(TOKEN)
  })

  it('accepts the right token: 201 on POST, 200 on DELETE', async () => {
    const app = createApp(db, { now: () => seed.now, adminToken: TOKEN })
    const posted = await post(app, registration(seed), TOKEN)
    expect(posted.status).toBe(201)
    const deleted = await del(app, 'acme-weth-usdc', TOKEN)
    expect(deleted.status).toBe(200)
  })

  it('leaves the read routes open', async () => {
    const app = createApp(db, { now: () => seed.now, adminToken: TOKEN })
    expect((await app.request('/api/mm')).status).toBe(200)
    expect((await app.request(`/api/mm/${seed.mandates.slipstreamOk.id}`)).status).toBe(200)
  })
})

describe('POST /api/mm', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now, adminToken: TOKEN })
  })
  afterEach(() => db.close())

  it('validates with parseMandate, upserts and returns 201 with the summary', async () => {
    const res = await post(app, registration(seed), TOKEN)
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const body = (await res.json()) as ScorecardSummaryDto
    const expected: PublicMandate = {
      id: 'acme-weth-usdc',
      name: 'ACME / WETH-USDC 0.05 %',
      poolId: seed.pools.wethUsdcV3.id,
      marketMaker: 'ACME Markets',
      addresses: ['0xabcdef0000000000000000000000000000000001'],
      kpis: {
        minDepthUsd: 50_000,
        bandPct: 2,
        maxSpreadBps: 30,
        spreadNotionalUsd: 10_000,
        targetUptime: 0.95,
      },
      alertWebhookConfigured: false,
      alertAfterSamples: 3,
      active: true,
      createdAt: seed.now,
      notes: null,
    }
    expect(body.mandate).toEqual(expected)
    expect(body.status).toBe('no-data')
    expect(body.latest).toBeNull()
    expect(body.streak).toEqual({ breached: false, samples: 0, since: null })
    const { alertWebhookConfigured: _configured, ...stored } = expected
    expect(db.mandates.get('acme-weth-usdc')).toEqual({ ...stored, alertWebhookUrl: null })
    const detail = await app.request('/api/mm/acme-weth-usdc')
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as ScorecardDetail).pool?.pool.id).toBe(seed.pools.wethUsdcV3.id)
  })

  it('re-registering an id replaces the mandate but keeps its samples and registration time', async () => {
    const existing = seed.mandates.aeroBreached
    const res = await post(
      app,
      registration(seed, {
        id: existing.id,
        poolId: existing.poolId,
        addresses: existing.addresses,
        kpis: { minDepthUsd: 5_000 },
        alertWebhookUrl: 'https://hooks.example.com/depthwatch',
        alertAfterSamples: 2,
        notes: 'relaxed',
      }),
      TOKEN,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as ScorecardSummaryDto
    // The registration replaces the mandate in full: omitted KPI fields take their defaults.
    expect(body.mandate.kpis.minDepthUsd).toBe(5_000)
    expect(body.mandate.kpis.maxSpreadBps).toBeNull()
    // The webhook URL is stored but never echoed: the response says only that one is set.
    expect(body.mandate.alertWebhookConfigured).toBe(true)
    expect(JSON.stringify(body)).not.toContain('hooks.example.com')
    expect(db.mandates.get(existing.id)?.alertWebhookUrl).toBe(
      'https://hooks.example.com/depthwatch',
    )
    expect(body.mandate.alertAfterSamples).toBe(2)
    expect(body.mandate.notes).toBe('relaxed')
    expect(body.mandate.createdAt).toBe(existing.createdAt)
    // Samples (and their stored evaluation) survive, so the summary still reads breached.
    expect(body.status).toBe('breached')
    expect(body.uptime.d7.samples).toBe(25)
    expect(db.mmSamples.countFor(existing.id)).toBe(25)
    expect(db.mandates.count()).toBe(2)
    // The reads serve the re-registered mandate at once, not a summary of the old one.
    const detail = (await (await app.request(`/api/mm/${existing.id}`)).json()) as ScorecardDetail
    expect(detail.mandate.kpis.minDepthUsd).toBe(5_000)
    expect(detail.mandate.notes).toBe('relaxed')
    const list = (await (await app.request('/api/mm')).json()) as ScorecardsResponse
    expect(list.items.find((i) => i.mandate.id === existing.id)?.mandate.notes).toBe('relaxed')
  })

  it('honours an explicit createdAt and active', async () => {
    const res = await post(
      app,
      registration(seed, { createdAt: 1_600_000_000, active: false }),
      TOKEN,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as ScorecardSummaryDto
    expect(body.mandate.createdAt).toBe(1_600_000_000)
    expect(body.mandate.active).toBe(false)
    expect(body.status).toBe('inactive')
  })

  it('returns 400 with every problem for an invalid registration', async () => {
    const res = await post(
      app,
      registration(seed, {
        id: 'Bad Id',
        name: '',
        addresses: ['0x123', 'nope'],
        kpis: { minDepthUsd: -1, bandPct: 150 },
        alertWebhookUrl: 'ftp://x',
        alertAfterSamples: 0,
      }),
      TOKEN,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as ErrorResponse
    expect(body.error).toMatch(/^invalid mandate: /)
    const paths = body.issues?.map((issue) => issue.path) ?? []
    expect(paths).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'addresses[0]',
        'addresses[1]',
        'kpis.minDepthUsd',
        'kpis.bandPct',
        'alertWebhookUrl',
        'alertAfterSamples',
      ]),
    )
    for (const issue of body.issues ?? []) expect(issue.message.length).toBeGreaterThan(0)
    expect(db.mandates.get('Bad Id')).toBeUndefined()
    expect(db.mandates.count()).toBe(2)
  })

  it('returns 400 for a non-object or unparsable body', async () => {
    const notObject = await post(app, '[]', TOKEN)
    expect(notObject.status).toBe(400)
    expect(((await notObject.json()) as ErrorResponse).issues).toEqual([
      { path: '(body)', message: 'mandate must be a JSON object' },
    ])
    const broken = await post(app, '{"id": ', TOKEN)
    expect(broken.status).toBe(400)
    expect(await broken.json()).toEqual({ error: 'invalid JSON body' })
    const empty = await app.request('/api/mm', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: 'invalid JSON body' })
  })

  it('checks auth before the body', async () => {
    const res = await post(app, '{"id": ', 'wrong')
    expect(res.status).toBe(401)
    const disabled = createApp(db, { now: () => seed.now })
    expect((await post(disabled, '{"id": ', TOKEN)).status).toBe(403)
  })
})

describe('DELETE /api/mm/:id', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now, adminToken: TOKEN })
  })
  afterEach(() => db.close())

  it('removes the mandate with its samples and alerts', async () => {
    const id = seed.mandates.aeroBreached.id
    db.mmAlerts.insert(fixtureMmAlert({ mandateId: id, timestamp: seed.now }))
    db.mmAlerts.insert(
      fixtureMmAlert({ mandateId: id, timestamp: seed.now + 1, kind: 'recovered' }),
    )
    const res = await del(app, id, TOKEN)
    expect(res.status).toBe(200)
    expect((await res.json()) as DeleteMandateResponse).toEqual({
      id,
      deleted: true,
      samplesDeleted: 25,
      alertsDeleted: 2,
    })
    expect(db.mandates.get(id)).toBeUndefined()
    expect(db.mmSamples.countFor(id)).toBe(0)
    expect(db.mmAlerts.countFor(id)).toBe(0)
    expect((await app.request(`/api/mm/${id}`)).status).toBe(404)
    expect((await app.request(`/api/mm/${id}/badge.svg`)).status).toBe(404)
    // The other mandate is untouched.
    expect(db.mmSamples.countFor(seed.mandates.slipstreamOk.id)).toBe(99)
    expect(db.mandates.count()).toBe(1)
  })

  it('404s for unknown mandates and is not repeatable', async () => {
    const missing = await del(app, 'nope', TOKEN)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'mandate not found' })
    const id = seed.mandates.slipstreamOk.id
    expect((await del(app, id, TOKEN)).status).toBe(200)
    expect((await del(app, id, TOKEN)).status).toBe(404)
  })
})
