import { summarizeScorecard, toPublicMandate } from '@depthwatch/core'
import { type Database, fixtureMandate, fixtureMmSample } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiContext } from './context.js'
import {
  compareScorecards,
  loadScorecard,
  SUMMARY_WINDOW_SECONDS,
  sortScorecards,
  summaryWindowStart,
  toScorecardDto,
} from './scorecard.js'
import { createSeededDatabase, type Seed } from './testing/seed.js'

describe('loadScorecard', () => {
  let db: Database
  let seed: Seed
  let ctx: ApiContext
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    ctx = { db, now: () => seed.now, source: 'live' }
  })
  afterEach(() => db.close())

  it('summarises the samples of the last 30 days at the context clock', () => {
    const mandate = seed.mandates.slipstreamOk
    const all = seed.mmSamples.get(mandate.id) ?? []
    const inWindow = all.filter((s) => s.timestamp >= summaryWindowStart(seed.now))
    expect(inWindow.length).toBeLessThan(all.length)
    const summary = loadScorecard(ctx, mandate)
    expect(summary).toEqual(summarizeScorecard(mandate, inWindow, seed.now))
    expect(summary.status).toBe('ok')
    expect(summary.uptime.d30.samples).toBe(inWindow.filter((s) => s.withinKpi !== null).length)
  })

  it('reads from now − 30 d inclusive', () => {
    expect(SUMMARY_WINDOW_SECONDS).toBe(30 * 86_400)
    const mandate = fixtureMandate({ id: 'edge-case', poolId: seed.pools.wethUsdcV3.id })
    db.mandates.upsert(mandate)
    const edge = summaryWindowStart(seed.now)
    db.mmSamples.insertMany([
      fixtureMmSample({ mandateId: mandate.id, timestamp: edge - 1, withinKpi: false }),
      fixtureMmSample({ mandateId: mandate.id, timestamp: edge, withinKpi: true }),
    ])
    const summary = loadScorecard(ctx, mandate)
    // The sample exactly at the bound is read; it sits outside the (now − 30 d, now] uptime
    // window but is the latest sample and decides the status.
    expect(summary.latest?.timestamp).toBe(edge)
    expect(summary.status).toBe('ok')
    expect(summary.uptime.d30.samples).toBe(0)
  })

  it('yields no-data for a mandate without samples and inactive for a deactivated one', () => {
    const fresh = fixtureMandate({ id: 'fresh-one', poolId: seed.pools.wethUsdcV3.id })
    db.mandates.upsert(fresh)
    expect(loadScorecard(ctx, fresh).status).toBe('no-data')
    db.mandates.setActive(seed.mandates.aeroBreached.id, false)
    const inactive = db.mandates.get(seed.mandates.aeroBreached.id)
    expect(inactive).toBeDefined()
    if (inactive) expect(loadScorecard(ctx, inactive).status).toBe('inactive')
  })

  it('toScorecardDto turns block numbers into decimal strings', () => {
    const dto = toScorecardDto(loadScorecard(ctx, seed.mandates.slipstreamOk))
    expect(typeof dto.latest?.blockNumber).toBe('string')
    expect(dto.latest?.blockNumber).toMatch(/^\d+$/)
    expect(dto.worst.minDepthDownUsd?.blockNumber).toMatch(/^\d+$/)
    // No bigint survives (JSON.stringify would throw on one).
    expect(() => JSON.stringify(dto)).not.toThrow()
    expect(dto.mandate).toEqual(toPublicMandate(seed.mandates.slipstreamOk))
  })

  it('toScorecardDto replaces the webhook URL by alertWebhookConfigured', () => {
    const secret = 'https://hooks.example.com/services/s3cr3t-token'
    const withHook = { ...seed.mandates.slipstreamOk, alertWebhookUrl: secret }
    const dto = toScorecardDto(loadScorecard(ctx, withHook))
    expect(dto.mandate.alertWebhookConfigured).toBe(true)
    expect('alertWebhookUrl' in dto.mandate).toBe(false)
    expect(JSON.stringify(dto)).not.toContain('s3cr3t')
    const without = toScorecardDto(loadScorecard(ctx, seed.mandates.slipstreamOk))
    expect(without.mandate.alertWebhookConfigured).toBe(false)
  })
})

describe('sortScorecards', () => {
  const summary = (id: string, name: string, active: boolean) =>
    summarizeScorecard(fixtureMandate({ id, name, active }), [], 1_700_000_000)

  it('puts active mandates first, then sorts by name (case-insensitive), then id', () => {
    const sorted = sortScorecards([
      summary('zeta', 'Zeta', false),
      summary('beta-2', 'beta', true),
      summary('alpha', 'alpha', false),
      summary('beta-1', 'Beta', true),
      summary('gamma', 'gamma', true),
    ])
    expect(sorted.map((s) => s.mandate.id)).toEqual(['beta-1', 'beta-2', 'gamma', 'alpha', 'zeta'])
    expect(compareScorecards(summary('a', 'x', true), summary('b', 'x', true))).toBeLessThan(0)
    expect(compareScorecards(summary('a', 'x', true), summary('a', 'x', true))).toBe(0)
  })

  it('does not mutate its input', () => {
    const input = [summary('b', 'b', true), summary('a', 'a', true)]
    const sorted = sortScorecards(input)
    expect(input.map((s) => s.mandate.id)).toEqual(['b', 'a'])
    expect(sorted.map((s) => s.mandate.id)).toEqual(['a', 'b'])
  })
})
