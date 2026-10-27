import { describe, expect, it } from 'vitest'
import { BADGE_COLOURS, badgeMessage } from '../lib/badge.js'
import {
  createMockClient,
  MOCK_MM_BREACHED_ID,
  MOCK_MM_BREACHED_POOL,
  MOCK_MM_OK_ID,
  MOCK_MM_OK_POOL,
} from './mock.js'

const NOW = 1_760_000_000
const DAY = 86_400
const client = createMockClient({ now: NOW })

describe('mock scorecards (mirror of the API seed)', () => {
  it('lists both mandates, active first then by name, with the seed statuses', async () => {
    const { items } = await client.scorecards()
    expect(items.map((s) => s.mandate.id)).toEqual([MOCK_MM_BREACHED_ID, MOCK_MM_OK_ID])
    expect(items.map((s) => s.status)).toEqual(['breached', 'ok'])
    for (const s of items) {
      expect(s.mandate.active).toBe(true)
      expect(s.mandate.addresses.every((a) => /^0x[0-9a-f]{40}$/.test(a))).toBe(true)
      expect(s.latest?.blockNumber).toMatch(/^\d+$/)
      expect(s.latest?.timestamp).toBe(NOW)
    }
  })

  it('filters by pool and by active state like GET /api/mm', async () => {
    expect(
      (await client.scorecards({ pool: MOCK_MM_OK_POOL })).items.map((s) => s.mandate.id),
    ).toEqual([MOCK_MM_OK_ID])
    expect((await client.scorecards({ pool: 'uniswap-v3:0xdead' })).items).toEqual([])
    expect((await client.scorecards({ active: true })).items).toHaveLength(2)
    expect((await client.scorecards({ active: false })).items).toEqual([])
  })

  it('computes the ok mandate with core: 24h uptime 1, 7d and 30d below 1', async () => {
    const ok = await client.scorecard(MOCK_MM_OK_ID)
    expect(ok.status).toBe('ok')
    expect(ok.mandate.kpis.maxSpreadBps).toBeNull()
    expect(ok.uptime.h24).toEqual({ windowHours: 24, samples: 12, withinKpi: 12, uptime: 1 })
    // 84 samples in the 7 d window, one unpriced (excluded), three breached.
    expect(ok.uptime.d7.samples).toBe(83)
    expect(ok.uptime.d7.withinKpi).toBe(80)
    expect(ok.uptime.d7.uptime).toBeCloseTo(80 / 83, 10)
    // The two 31-day-old samples are outside the summary window.
    expect(ok.uptime.d30.samples).toBe(96)
    expect(ok.uptime.d30.withinKpi).toBe(93)
    expect(ok.worst.minDepthDownUsd?.value).toBe(42_000)
    expect(ok.worst.minDepthDownUsd?.threshold).toBe(50_000)
    expect(ok.worst.minDepthDownUsd?.kind).toBe('depthDown')
    expect(ok.worst.minDepthDownUsd?.blockNumber).toMatch(/^\d+$/)
    expect(ok.worst.maxSpreadBps).toBeNull()
    expect(ok.streak).toEqual({ breached: false, samples: 58, since: NOW - 57 * 2 * 3600 })
    expect(ok.pool?.pool.id).toBe(MOCK_MM_OK_POOL)
    expect(ok.pool?.pool.dex).toBe('aerodrome-slipstream')
  })

  it('computes the breached mandate: breached since its seventh sample', async () => {
    const bad = await client.scorecard(MOCK_MM_BREACHED_ID)
    expect(bad.status).toBe('breached')
    expect(bad.latest?.withinKpi).toBe(false)
    expect(bad.latest?.breaches).toEqual(['depthUp', 'depthDown'])
    expect(bad.streak).toEqual({ breached: true, samples: 19, since: NOW - 18 * 2 * 3600 })
    expect(bad.uptime.h24.uptime).toBe(0)
    expect(bad.uptime.d7.samples).toBe(25)
    expect(bad.uptime.d7.withinKpi).toBe(6)
    expect(bad.worst.maxSpreadBps?.kind).toBe('spread')
    expect(bad.worst.maxSpreadBps?.threshold).toBe(40)
    expect(bad.pool?.pool.id).toBe(MOCK_MM_BREACHED_POOL)
  })

  it('serves sample windows with inclusive bounds, ascending, newest kept under a limit', async () => {
    const week = await client.scorecardSamples(MOCK_MM_OK_ID)
    expect(week.window).toBe('7d')
    expect(week.to).toBe(NOW)
    expect(week.from).toBe(NOW - 7 * DAY)
    expect(week.points).toHaveLength(85)
    expect(week.points[0]?.timestamp).toBe(week.from)
    expect(week.points.at(-1)?.timestamp).toBe(week.to)
    for (let i = 1; i < week.points.length; i++) {
      expect(week.points[i]?.timestamp).toBeGreaterThan(week.points[i - 1]?.timestamp ?? 0)
    }
    expect(week.points.every((p) => typeof p.blockNumber === 'string')).toBe(true)
    expect(week.points.filter((p) => p.withinKpi === false)).toHaveLength(3)
    expect(week.points.filter((p) => p.withinKpi === null)).toHaveLength(1)

    const day = await client.scorecardSamples(MOCK_MM_OK_ID, { window: '24h' })
    expect(day.points).toHaveLength(13)
    expect(day.from).toBe(NOW - DAY)

    const month = await client.scorecardSamples(MOCK_MM_OK_ID, { window: '30d' })
    expect(month.points).toHaveLength(97)

    const limited = await client.scorecardSamples(MOCK_MM_OK_ID, { window: '7d', limit: 10 })
    expect(limited.points).toHaveLength(10)
    expect(limited.points.at(-1)?.timestamp).toBe(NOW)
    expect(limited.points[0]?.timestamp).toBe(week.points.at(-10)?.timestamp)
  })

  it('answers unknown ids with the API error body on every route', async () => {
    const notFound = { status: 404, message: 'mandate not found' }
    await expect(client.scorecard('nope')).rejects.toMatchObject(notFound)
    await expect(client.scorecardSamples('nope')).rejects.toMatchObject(notFound)
    await expect(client.badge('nope')).rejects.toMatchObject(notFound)
  })

  it('renders the badge the API would', async () => {
    const ok = await client.badge(MOCK_MM_OK_ID)
    expect(ok.startsWith('<?xml version="1.0" encoding="UTF-8"?><svg')).toBe(true)
    expect(ok).toContain(`>${badgeMessage('ok', 80 / 83)}<`)
    expect(ok).toContain('ok · 7d 96.4%')
    expect(ok).toContain(`fill="${BADGE_COLOURS.ok}"`)
    const bad = await client.badge(MOCK_MM_BREACHED_ID)
    expect(bad).toContain('breached · 7d 24%')
    expect(bad).toContain(`fill="${BADGE_COLOURS.breached}"`)
  })
})
