/**
 * `POST /api/mm` input rules: the pool id is stored lowercase (or rejected when malformed), the
 * registration is held to `MANDATE_LIMITS` and the body to `MAX_REGISTRATION_BYTES`, and a
 * re-registration keeps a deactivated mandate deactivated unless the body says otherwise.
 */
import { MANDATE_LIMITS } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type {
  ErrorResponse,
  ScorecardDetail,
  ScorecardSummaryDto,
  ScorecardsResponse,
} from '../dto.js'
import { createSeededDatabase, type Seed } from '../testing/seed.js'
import { MAX_REGISTRATION_BYTES } from './mm.js'

const TOKEN = 'test-admin-token'

async function post(app: Hono, body: unknown): Promise<Response> {
  return app.request('/api/mm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/mm input', () => {
  let db: Database
  let seed: Seed
  let app: Hono
  let registration: Record<string, unknown>
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    app = createApp(db, { now: () => seed.now, adminToken: TOKEN })
    registration = {
      id: 'acme-weth-usdc',
      name: 'ACME / WETH-USDC 0.05 %',
      poolId: seed.pools.wethUsdcV3.id,
      marketMaker: 'ACME Markets',
      addresses: ['0xabcdef0000000000000000000000000000000001'],
      kpis: { minDepthUsd: 50_000 },
    }
  })
  afterEach(() => db.close())

  it('stores a mixed-case pool id lowercase, so the mandate is found by its pool', async () => {
    // A checksummed address, as a block explorer prints it.
    const checksummed = 'uniswap-v3:0xD0B53D9277642d899DF5C87A3966A349A798F224'
    const poolId = checksummed.toLowerCase()
    const res = await post(app, { ...registration, poolId: checksummed })
    expect(res.status).toBe(201)
    expect(((await res.json()) as ScorecardSummaryDto).mandate.poolId).toBe(poolId)
    expect(db.mandates.get('acme-weth-usdc')?.poolId).toBe(poolId)
    const list = await app.request(`/api/mm?pool=${encodeURIComponent(poolId)}`)
    const items = ((await list.json()) as ScorecardsResponse).items.map((i) => i.mandate.id)
    expect(items).toEqual(['acme-weth-usdc'])
    // A known pool written in upper case links the scorecard to the observatory's row.
    const known = seed.pools.wethUsdcV3.id
    expect((await post(app, { ...registration, poolId: known.toUpperCase() })).status).toBe(201)
    const detail = (await (await app.request('/api/mm/acme-weth-usdc')).json()) as ScorecardDetail
    expect(detail.mandate.poolId).toBe(known)
    expect(detail.pool?.pool.id).toBe(known)
  })

  it('rejects a malformed pool id with 400 on the poolId field', async () => {
    for (const poolId of [
      'not a pool at all',
      'uniswap-v9:0x1',
      `uniswap-v3:0x${'a'.repeat(64)}`,
    ]) {
      const res = await post(app, { ...registration, poolId })
      expect(res.status, poolId).toBe(400)
      expect(((await res.json()) as ErrorResponse).issues?.map((i) => i.path)).toEqual(['poolId'])
    }
    expect(db.mandates.get('acme-weth-usdc')).toBeUndefined()
  })

  it('answers 400 beyond MANDATE_LIMITS', async () => {
    const addresses = Array.from(
      { length: MANDATE_LIMITS.addresses + 1 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
    )
    const res = await post(app, {
      ...registration,
      name: 'x'.repeat(MANDATE_LIMITS.name + 1),
      addresses,
      notes: 'n'.repeat(MANDATE_LIMITS.notes + 1),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).issues).toEqual([
      { path: 'name', message: 'name must be at most 120 characters' },
      { path: 'addresses', message: 'addresses must list at most 50 addresses' },
      { path: 'notes', message: 'notes must be at most 2000 characters' },
    ])
  })

  it('answers 413 for a body over MAX_REGISTRATION_BYTES without storing anything', async () => {
    const body = JSON.stringify({ ...registration, notes: 'n'.repeat(100 * 1024) })
    expect(body.length).toBeGreaterThan(MAX_REGISTRATION_BYTES)
    const res = await post(app, body)
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'request body too large' })
    expect(db.mandates.get('acme-weth-usdc')).toBeUndefined()
  })

  it('keeps a deactivated mandate deactivated when it is registered again without active', async () => {
    const id = seed.mandates.aeroBreached.id
    db.mandates.setActive(id, false)
    const existing = db.mandates.get(id)
    const again = { ...registration, id, poolId: existing?.poolId }
    const res = await post(app, again)
    expect(res.status).toBe(201)
    const body = (await res.json()) as ScorecardSummaryDto
    expect(body.mandate.active).toBe(false)
    expect(body.status).toBe('inactive')
    expect(db.mandates.get(id)?.active).toBe(false)
    const resumed = await post(app, { ...again, active: true })
    expect(((await resumed.json()) as ScorecardSummaryDto).mandate.active).toBe(true)
    expect(db.mandates.get(id)?.active).toBe(true)
  })
})
