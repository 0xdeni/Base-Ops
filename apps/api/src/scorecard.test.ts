import { summarizeScorecard, toPublicMandate } from '@depthwatch/core'
import { type Database, fixtureMandate, fixtureMmSample } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiContext } from './context.js'
import {
  compareScorecards,
  loadScorecard,
  SCORECARD_CACHE_SECONDS,
  ScorecardCache,
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
    const now = () => seed.now
    ctx = { db, now, scorecards: new ScorecardCache(db, now), source: 'live' }
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
      fixtureMmSample({
        mandateId: mandate.id,
        timestamp: edge - 1,
        blockNumber: 1n,
        withinKpi: false,
      }),
      fixtureMmSample({ mandateId: mandate.id, timestamp: edge, blockNumber: 2n, withinKpi: true }),
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

describe('ScorecardCache', () => {
  let db: Database
  let seed: Seed
  let clock: number
  let cache: ScorecardCache
  beforeEach(() => {
    ;({ db, seed } = createSeededDatabase())
    clock = seed.now
    cache = new ScorecardCache(db, () => clock)
  })
  afterEach(() => db.close())

  it('serves the same summary again while the mandate, its samples and the minute are unchanged', () => {
    const mandate = seed.mandates.slipstreamOk
    const first = cache.get(mandate)
    expect(cache.get(mandate)).toBe(first)
    expect(cache.get({ ...mandate })).toBe(first)
    clock = minuteOf(seed.now) + SCORECARD_CACHE_SECONDS - 1
    expect(cache.get(mandate)).toBe(first)
    expect(cache.size).toBe(1)
    // A mandate the cache never saw is computed, and the other entry stays.
    expect(cache.get(seed.mandates.aeroBreached).status).toBe('breached')
    expect(cache.size).toBe(2)
    expect(cache.get(mandate)).toBe(first)
  })

  it('recomputes after a new sample, a re-registration and a new minute', () => {
    const mandate = seed.mandates.slipstreamOk
    const first = cache.get(mandate)
    expect(first.status).toBe('ok')

    db.mmSamples.insert(
      fixtureMmSample({
        mandateId: mandate.id,
        poolId: mandate.poolId,
        timestamp: seed.now,
        withinKpi: false,
        breaches: ['depthDown'],
      }),
    )
    const afterSample = cache.get(mandate)
    expect(afterSample).not.toBe(first)
    expect(afterSample.latest?.breaches).toEqual(['depthDown'])
    expect(afterSample.uptime.d30.samples).toBe(first.uptime.d30.samples + 1)
    expect(cache.get(mandate)).toBe(afterSample)

    // The write routes need no hook: a changed mandate (from any process) misses the entry.
    const relaxed = { ...mandate, kpis: { ...mandate.kpis, minDepthUsd: 1 } }
    db.mandates.upsert(relaxed)
    const afterUpsert = cache.get(relaxed)
    expect(afterUpsert).not.toBe(afterSample)
    expect(afterUpsert.mandate.kpis.minDepthUsd).toBe(1)
    expect(cache.get(relaxed)).toBe(afterUpsert)

    clock = minuteOf(seed.now) + SCORECARD_CACHE_SECONDS
    const nextMinute = cache.get(relaxed)
    expect(nextMinute).not.toBe(afterUpsert)
    expect(nextMinute).toEqual(summarizeScorecard(relaxed, samplesOf(db, relaxed.id, clock), clock))
    expect(cache.get(relaxed)).toBe(nextMinute)
  })

  it('forgets a deleted mandate and starts afresh when it is registered again', () => {
    const mandate = seed.mandates.aeroBreached
    expect(cache.get(mandate).status).toBe('breached')
    db.mandates.delete(mandate.id)
    db.mmSamples.deleteFor(mandate.id)
    cache.delete(mandate.id)
    expect(cache.size).toBe(0)
    db.mandates.upsert(mandate)
    expect(cache.get(mandate).status).toBe('no-data')
  })

  function samplesOf(database: Database, mandateId: string, now: number) {
    return database.mmSamples.seriesFor(mandateId, summaryWindowStart(now))
  }

  function minuteOf(ts: number): number {
    return Math.floor(ts / SCORECARD_CACHE_SECONDS) * SCORECARD_CACHE_SECONDS
  }
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
