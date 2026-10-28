import { describe, expect, it } from 'vitest'
import type { BreachEpisode } from '../../lib/scorecard.js'
import {
  alertsLine,
  attributionWords,
  episodeLowest,
  episodesLine,
  episodeWhat,
  listAnswer,
  mandateWhere,
  markWord,
  maxSpreadWords,
  midAddress,
  minDepthWords,
  poolWords,
  readWindow,
  sampleWords,
  scorecardAnswer,
  streakLine,
  uptimeFact,
  uptimeLabel,
  uptimeLine,
  windowDomain,
  windowPoints,
} from './mmText.js'

const NB = ' '
const NOW = 1_792_713_600
const H = 3600

function mandate(active = true) {
  return {
    id: 'm',
    name: 'M',
    poolId: 'aerodrome-v2:0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d',
    marketMaker: 'Alice',
    addresses: [],
    kpis: {
      minDepthUsd: 50_000,
      bandPct: 2,
      maxSpreadBps: null,
      spreadNotionalUsd: 10_000,
      targetUptime: 0.95,
    },
    alertWebhookConfigured: false,
    alertAfterSamples: 3,
    active,
    createdAt: NOW - 7 * 24 * H,
    notes: null,
  }
}

const latest = { timestamp: NOW - 120 } as never

function ep(over: Partial<BreachEpisode> = {}): BreachEpisode {
  return {
    start: NOW - 14 * H,
    end: NOW,
    samples: 8,
    kinds: ['depthUp', 'depthDown'],
    minUpUsd: 7400,
    minDownUsd: 7600,
    ongoing: true,
    ...over,
  }
}

describe('streak line (ia-v3 §4.6)', () => {
  it('states the streak and since when', () => {
    const sc = {
      mandate: mandate(),
      latest,
      streak: { breached: true, samples: 8, since: NOW - 14 * H },
    }
    expect(streakLine(sc, NOW)).toBe(`Breached for 8 consecutive samples, since 14${NB}h ago.`)
  })

  it('reads within KPI, a single sample, no samples and inactive mandates', () => {
    const within = {
      mandate: mandate(),
      latest,
      streak: { breached: false, samples: 29, since: NOW - 2 * 24 * H },
    }
    expect(streakLine(within, NOW)).toMatch(
      /^Within KPI for 29 consecutive samples, since 21.Oct, 00:00.UTC\.$/,
    )
    const one = {
      mandate: mandate(),
      latest,
      streak: { breached: true, samples: 1, since: NOW - 120 },
    }
    expect(streakLine(one, NOW)).toBe(`Breached at the latest sample, 2${NB}min ago.`)
    const none = {
      mandate: mandate(),
      latest: null,
      streak: { breached: false, samples: 0, since: null },
    }
    expect(streakLine(none, NOW)).toBe('No samples yet.')
    expect(streakLine({ ...within, mandate: mandate(false) }, NOW)).toBe(
      `Inactive since its last sample, 2${NB}min ago.`,
    )
    expect(streakLine({ ...none, mandate: mandate(false) }, NOW)).toBe('Inactive, with no samples.')
  })
})

describe('scorecard answer (visual-v4 §6.7)', () => {
  const sample = (breaches: string[], withinKpi: boolean | null = breaches.length === 0) =>
    ({
      timestamp: NOW - 120,
      withinKpi,
      breaches,
      attribution: { depthDownUsd: 386_000, depthUpUsd: 425_000, spreadBps: 52 },
    }) as never
  const sc = (latest: unknown, maxSpreadBps: number | null = null) => {
    const m = mandate()
    return {
      mandate: { ...m, kpis: { ...m.kpis, minDepthUsd: 400_000, maxSpreadBps } },
      latest,
    } as never
  }

  it('names the side below the KPI with its depth, from the stored evaluation', () => {
    expect(scorecardAnswer(sc(sample(['depthDown'])), NOW)).toBe(
      `The sell side is below its $400K KPI: $386K sits within 2${NB}% of the price.`,
    )
    expect(scorecardAnswer(sc(sample(['depthUp'])), NOW)).toBe(
      `The buy side is below its $400K KPI: $425K sits within 2${NB}% of the price.`,
    )
    expect(scorecardAnswer(sc(sample(['depthUp', 'depthDown'])), NOW)).toBe(
      `Both sides are below the $400K KPI: $386K and $425K sit within 2${NB}% of the price.`,
    )
  })

  it('reads a spread breach, no liquidity, an unpriced sample and a sample within KPI', () => {
    expect(scorecardAnswer(sc(sample(['spread']), 40), NOW)).toBe(
      `Both sides hold the $400K KPI, but the spread at $10K is 52.0${NB}bps, above its 40.0${NB}bps KPI.`,
    )
    expect(scorecardAnswer(sc(sample(['noLiquidity'])), NOW)).toBe(
      'The latest sample found none of the market maker’s liquidity in the pool.',
    )
    expect(scorecardAnswer(sc(sample([], null)), NOW)).toBe(
      'The latest sample has no USD price, so it can’t be checked.',
    )
    expect(scorecardAnswer(sc(sample([])), NOW)).toBe(
      'Both sides are within the $400K KPI at the latest sample.',
    )
    expect(scorecardAnswer(sc(null), NOW)).toBe('No samples yet.')
    expect(scorecardAnswer({ mandate: mandate(false), latest } as never, NOW)).toBe(
      `Inactive since its last sample, 2${NB}min ago.`,
    )
  })
})

describe('list answer (ia-v3 §4.5)', () => {
  const sc = (status: string, active = true) => ({ mandate: mandate(active), status }) as never
  it('counts the mandates within their KPIs', () => {
    expect(listAnswer([sc('breached'), sc('ok')])).toBe(
      '1 of 2 mandates is within its KPIs right now.',
    )
    expect(listAnswer([sc('ok'), sc('ok')])).toBe(
      '2 of 2 mandates are within their KPIs right now.',
    )
    expect(listAnswer([sc('breached')])).toBe('0 of 1 mandate is within its KPIs right now.')
  })
  it('counts active mandates only when some are inactive, and says when there are none', () => {
    expect(listAnswer([sc('ok'), sc('inactive', false)])).toBe(
      '1 of 1 active mandate is within its KPIs right now.',
    )
    expect(listAnswer([sc('inactive', false), sc('inactive', false)])).toBe(
      'All 2 mandates are inactive.',
    )
    expect(listAnswer([])).toBe('No market-maker mandates are registered yet.')
    expect(listAnswer([], true)).toBe('No market-maker mandates are registered in this snapshot.')
  })
})

describe('labels and lines', () => {
  it('words a KPI mark and the uptime fact (visual-v4 §6.7)', () => {
    expect(markWord('pass')).toBe('within')
    expect(markWord('fail')).toBe('below')
    expect(markWord('fail', 'above')).toBe('above')
    expect(markWord('n/a')).toBe('not evaluable against')
    expect(uptimeLabel({ samples: 84, uptime: 0.429 }, 0.95)).toBe(
      `samples within KPI in 7${NB}d: uptime 42.9${NB}%, target 95${NB}%`,
    )
    expect(uptimeLabel({ samples: 0, uptime: null }, 0.95)).toBe(
      `samples within KPI in 7${NB}d: none evaluable yet, target 95${NB}%`,
    )
    // The count leads the uptime fact, so one sample never reads as a rate alone.
    expect(uptimeFact({ samples: 1, withinKpi: 0, uptime: 0 })).toBe('0 of 1')
    expect(uptimeFact({ samples: 0, withinKpi: 0, uptime: null })).toBe('—')
  })

  it('carries the counts in the Uptime takeaway (ia-v3 §4.6)', () => {
    const u = { windowHours: 168, samples: 84, withinKpi: 36, uptime: 36 / 84 }
    expect(uptimeLine(u, '7d', 0.95)).toBe(
      `36 of 84 samples within KPI over 7 days (target 95${NB}%).`,
    )
    expect(uptimeLine({ ...u, samples: 0, withinKpi: 0, uptime: null }, '24h', 0.95)).toBe(
      'No evaluable samples in 24 hours.',
    )
  })

  it('describes breach episodes', () => {
    expect(episodesLine([ep(), ep({ ongoing: false })], '7d')).toBe(
      `2 breach episodes in 7 days, the longest 14${NB}h.`,
    )
    expect(episodesLine([], '30d')).toBe('No breaches in 30 days.')
    expect(episodesLine([ep({ samples: 1, end: NOW - 14 * H })], '24h')).toBe(
      '1 breach episode in 24 hours, each a single sample.',
    )
    expect(episodeWhat(ep())).toBe(`14${NB}h, ongoing, 8 samples, both sides`)
    expect(episodeWhat(ep({ samples: 1, ongoing: false, kinds: ['depthDown'] }))).toBe(
      '1 sample, sell side',
    )
    expect(alertsLine(3)).toBe('Alerts fire after 3 in a row.')
    expect(alertsLine(1)).toBe('Alerts fire on the first breached sample.')
    expect(episodeLowest(ep())).toBe(7400)
    expect(episodeLowest(ep({ minUpUsd: null, minDownUsd: null }))).toBeNull()
    expect(sampleWords({ withinKpi: false, breaches: ['depthUp', 'spread'] })).toBe(
      'Breached, buy side and spread',
    )
    expect(sampleWords({ withinKpi: null, breaches: [] })).toBe('Not evaluable')
  })

  it('words the Mandate list', () => {
    expect(attributionWords({ method: 'lp-share', holdings: 1 })).toBe('LP share, 1 holder')
    expect(attributionWords({ method: 'positions', holdings: 2 })).toBe('2 positions')
    expect(attributionWords(null)).toBe('—')
    expect(minDepthWords({ minDepthUsd: 50_000, bandPct: 2 })).toBe(`$50K per side within ±2${NB}%`)
    expect(maxSpreadWords({ maxSpreadBps: 40, spreadNotionalUsd: 10_000 })).toBe(
      `40.0${NB}bps at $10K`,
    )
    expect(maxSpreadWords({ maxSpreadBps: null, spreadNotionalUsd: 10_000 })).toBe('None')
    expect(midAddress('0xa29d93f3c0ffee000000000000000000a0f0a0f7')).toBe('0xa29d93f3…f0a0f7')
    const meta = {
      token0: { symbol: 'WETH' },
      token1: { symbol: 'USDC' },
      dex: 'uniswap-v3',
      feePips: 500,
    }
    expect(mandateWhere({ marketMaker: 'Alice', poolId: 'uniswap-v3:0xabc' }, meta)).toBe(
      `Alice on WETH / USDC, Uniswap v3 0.05${NB}%`,
    )
    expect(poolWords('aerodrome-v2:0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d', null)).toEqual({
      pair: '0x6cdc…971d',
      dex: 'Aerodrome v2',
    })
  })
})

describe('windows (URL and domains)', () => {
  it('reads ?window= with 7 d as the default', () => {
    expect(readWindow(null)).toBe('7d')
    expect(readWindow('24h')).toBe('24h')
    expect(readWindow('30d')).toBe('30d')
    expect(readWindow('1y')).toBe('7d')
  })

  it('counts a window the way uptime does: (from, to]', () => {
    const dom = windowDomain(NOW, '24h')
    expect(dom).toEqual([NOW - 24 * H, NOW])
    const pts = [NOW - 26 * H, NOW - 24 * H, NOW - 2 * H, NOW].map((timestamp) => ({ timestamp }))
    expect(windowPoints(pts, dom).map((p) => p.timestamp)).toEqual([NOW - 2 * H, NOW])
  })
})
