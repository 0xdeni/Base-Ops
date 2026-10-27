import { evaluateKpis, type MandateKpis } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import type { MmSampleDto, ScorecardSummaryDto } from '../api/types.js'
import { samples } from '../components/charts/chartFixtures.js'
import {
  badgeImgSnippet,
  badgeMarkdownSnippet,
  badgeUrl,
  breachEpisodes,
  breachSides,
  compareScorecards,
  dailySummary,
  episodeHours,
  mmHref,
  sampleInterval,
  sampleKeys,
  sampleMark,
  scorecardUrl,
  splitPoolId,
} from './scorecard.js'

const ORIGIN = 'https://depthwatch.example'
const KPIS = ['depthUp', 'depthDown', 'spread'] as const

function sample(
  patch: Partial<MmSampleDto['attribution']>,
  withinKpi: boolean | null,
): MmSampleDto {
  return {
    mandateId: 'm',
    poolId: 'uniswap-v3:0xabc',
    blockNumber: '1',
    timestamp: 1_700_000_000,
    attribution: {
      method: 'positions',
      holdings: 1,
      shareOfPool: 0.2,
      depthUpUsd: 60_000,
      depthDownUsd: 58_000,
      poolDepthUpUsd: 200_000,
      poolDepthDownUsd: 200_000,
      spreadBps: 20,
      poolSpreadBps: 15,
      ...patch,
    },
    withinKpi,
    breaches: withinKpi === false ? ['depthDown'] : [],
  }
}

function kpis(maxSpreadBps: number | null, minDepthUsd = 50_000): MandateKpis {
  return { minDepthUsd, bandPct: 2, maxSpreadBps, spreadNotionalUsd: 10_000, targetUptime: 0.95 }
}

/** A sample whose `withinKpi` and `breaches` come from core, as the pipeline stores them. */
function evaluated(
  patch: Partial<MmSampleDto['attribution']>,
  sampledWith: MandateKpis,
): MmSampleDto {
  const base = sample(patch, null)
  return { ...base, ...evaluateKpis(base.attribution, sampledWith) }
}

function summary(
  latest: MmSampleDto | null,
  maxSpreadBps: number | null,
  uptime7d: number | null,
  minDepthUsd = 50_000,
): Pick<ScorecardSummaryDto, 'mandate' | 'latest' | 'uptime'> {
  const window = (hours: number) => ({
    windowHours: hours,
    samples: uptime7d === null ? 0 : 10,
    withinKpi: uptime7d === null ? 0 : Math.round(uptime7d * 10),
    uptime: uptime7d,
  })
  return {
    mandate: {
      id: 'demo',
      name: 'Demo',
      poolId: 'uniswap-v3:0xabc',
      marketMaker: 'MM',
      addresses: ['0x00000000000000000000000000000000000000b1'],
      kpis: kpis(maxSpreadBps, minDepthUsd),
      alertWebhookConfigured: false,
      alertAfterSamples: 3,
      active: true,
      createdAt: 1,
      notes: null,
    },
    latest,
    uptime: { h24: window(24), d7: window(168), d30: window(720) },
  }
}

describe('badge and page URLs', () => {
  it('builds the absolute badge URL, tolerating a trailing slash on the origin', () => {
    expect(badgeUrl(ORIGIN, 'demo-slipstream-weth-usdc')).toBe(
      `${ORIGIN}/api/mm/demo-slipstream-weth-usdc/badge.svg`,
    )
    expect(badgeUrl(`${ORIGIN}/`, 'x')).toBe(`${ORIGIN}/api/mm/x/badge.svg`)
    expect(scorecardUrl(ORIGIN, 'x')).toBe(`${ORIGIN}/mm/x`)
    expect(mmHref('demo')).toBe('/mm/demo')
  })

  it('writes the HTML snippet with the badge linked to the scorecard and escaped alt text', () => {
    expect(badgeImgSnippet(ORIGIN, 'demo', 'Acme "Prime" <MM>')).toBe(
      `<a href="${ORIGIN}/mm/demo"><img src="${ORIGIN}/api/mm/demo/badge.svg" alt="Depthwatch scorecard: Acme &quot;Prime&quot; &lt;MM>"></a>`,
    )
  })

  it('writes the Markdown snippet', () => {
    expect(badgeMarkdownSnippet(ORIGIN, 'demo', 'Acme [x]')).toBe(
      `[![Depthwatch scorecard: Acme [x\\]](${ORIGIN}/api/mm/demo/badge.svg)](${ORIGIN}/mm/demo)`,
    )
  })
})

describe("sampleMark against core's stored evaluation", () => {
  it('fails every KPI of a no-liquidity sample, even with an unpriced side', () => {
    // Rule 1 with token1 unpriced: depthUpUsd is null, yet core breaches depthUp.
    const latest = evaluated(
      {
        method: 'none',
        holdings: 0,
        shareOfPool: null,
        depthUpUsd: null,
        depthDownUsd: 0,
        poolDepthUpUsd: null,
        spreadBps: null,
      },
      kpis(30),
    )
    expect(latest.withinKpi).toBe(false)
    expect(latest.breaches).toEqual(['noLiquidity', 'depthUp', 'depthDown', 'spread'])
    expect(KPIS.map((k) => sampleMark(latest, k))).toEqual(['fail', 'fail', 'fail'])
  })

  it('is n/a for an unpriced sample: one priced side does not make it evaluable (rule 2)', () => {
    const halfPriced = evaluated({ depthUpUsd: null, depthDownUsd: 60_000 }, kpis(40))
    expect(KPIS.map((k) => sampleMark(halfPriced, k))).toEqual(['n/a', 'n/a', 'n/a'])
  })

  it('treats an infeasible spread as a failure of the spread KPI only', () => {
    const infeasible = evaluated({ spreadBps: null }, kpis(40))
    expect(KPIS.map((k) => sampleMark(infeasible, k))).toEqual(['pass', 'pass', 'fail'])
  })

  it('follows the stored evaluation, like the status, after the KPIs changed', () => {
    // Within KPI when sampled against $50K; the mandate was re-registered with $70K since.
    const within = evaluated({}, kpis(40))
    expect(within.withinKpi).toBe(true)
    expect(KPIS.map((k) => sampleMark(within, k))).toEqual(['pass', 'pass', 'pass'])
    // A breach against a since-loosened KPI stays a breach until the next sample.
    const breached = evaluated({ depthDownUsd: 42_000 }, kpis(40))
    expect(KPIS.map((k) => sampleMark(breached, k))).toEqual(['pass', 'fail', 'pass'])
  })
})

describe('sampleMark', () => {
  it('reads the stored evaluation of one KPI', () => {
    expect(sampleMark(null, 'depthUp')).toBe('n/a')
    expect(sampleMark(undefined, 'spread')).toBe('n/a')
    expect(sampleMark({ withinKpi: null, breaches: [] }, 'spread')).toBe('n/a')
    expect(sampleMark({ withinKpi: true, breaches: [] }, 'depthDown')).toBe('pass')
    const spreadOnly = { withinKpi: false, breaches: ['spread' as const] }
    expect(sampleMark(spreadOnly, 'spread')).toBe('fail')
    expect(sampleMark(spreadOnly, 'depthUp')).toBe('pass')
    const noLiquidity = { withinKpi: false, breaches: ['noLiquidity' as const] }
    expect(sampleMark(noLiquidity, 'depthUp')).toBe('fail')
    expect(sampleMark(noLiquidity, 'spread')).toBe('fail')
  })
})

describe('sampleKeys', () => {
  it('is unique when samples share a block and timestamp, and stable for the first of each', () => {
    const at = (blockNumber: string, timestamp: number) => ({ blockNumber, timestamp })
    expect(sampleKeys([at('2', 102), at('1', 100), at('1', 100), at('1', 100)])).toEqual([
      '2:102',
      '1:100',
      '1:100:1',
      '1:100:2',
    ])
    expect(sampleKeys([at('1', 100), at('2', 100)])).toEqual(['1:100', '2:100'])
    expect(sampleKeys([])).toEqual([])
  })
})

describe('splitPoolId / compareScorecards', () => {
  it('splits pool ids at the first colon', () => {
    expect(splitPoolId('aerodrome-v2:0xabc')).toEqual({ dex: 'aerodrome-v2', key: '0xabc' })
    expect(splitPoolId('plain')).toEqual({ dex: null, key: 'plain' })
  })

  it('orders active mandates first, then by name (case-insensitive), then id', () => {
    const m = (id: string, name: string, active: boolean) => ({
      mandate: { ...summary(null, null, null).mandate, id, name, active },
    })
    // Like the API's `compareScorecards`: a case-insensitive tie falls back to code-point order
    // of the names ("Alpha" before "alpha"), then to the id.
    const sorted = [m('c', 'beta', false), m('b', 'Alpha', true), m('a', 'alpha', true)].sort(
      compareScorecards,
    )
    expect(sorted.map((s) => s.mandate.id)).toEqual(['b', 'a', 'c'])
    const tie = [m('b', 'same', true), m('a', 'same', true)].sort(compareScorecards)
    expect(tie.map((s) => s.mandate.id)).toEqual(['a', 'b'])
  })
})

describe('breach episodes (ia-v3 §4.6, §6.2)', () => {
  it('collapses consecutive breached samples, with durations end − start', () => {
    // 8 samples two hours apart: 14 h, matching the answer's "since 14 h ago".
    const eps = breachEpisodes(samples('oobbbbbbbbo'))
    expect(eps).toHaveLength(1)
    const [ep] = eps
    expect(ep?.samples).toBe(8)
    expect(episodeHours(ep ?? { start: 0, end: 0 })).toBe(14)
    expect(ep?.kinds).toEqual(['depthUp', 'depthDown'])
    expect(ep?.ongoing).toBe(false)
  })

  it('keeps the lowest depth per side and marks an open episode as ongoing', () => {
    const eps = breachEpisodes(samples('bbobbs'))
    expect(eps.map((e) => e.samples)).toEqual([2, 3])
    expect(eps[0]?.minUpUsd).toBe(7_400)
    expect(eps[0]?.minDownUsd).toBe(7_600)
    expect(eps[1]?.ongoing).toBe(true)
    // The sell-only sample adds no buy-side breach and a within-KPI buy side.
    expect(eps[1]?.minUpUsd).toBe(7_403)
    expect(eps[1]?.kinds).toEqual(['depthUp', 'depthDown'])
  })

  it('lets an unevaluable sample neither breach nor interrupt (as core streaks do)', () => {
    const eps = breachEpisodes(samples('bbubbuo'))
    expect(eps).toHaveLength(1)
    expect(eps[0]?.samples).toBe(4)
    expect(episodeHours(eps[0] ?? { start: 0, end: 0 })).toBe(8)
    expect(breachEpisodes(samples('uuu'))).toEqual([])
  })

  it('reads the series in time order whatever order it arrives in', () => {
    const shuffled = samples('obbo').reverse()
    expect(breachEpisodes(shuffled)[0]?.samples).toBe(2)
  })

  it('names what an episode breached', () => {
    expect(breachSides(['depthUp', 'depthDown'])).toBe('both sides')
    expect(breachSides(['depthDown'])).toBe('sell side')
    expect(breachSides(['depthUp', 'spread'])).toBe('buy side and spread')
    expect(breachSides(['spread'])).toBe('spread')
    expect(breachSides(['noLiquidity', 'depthUp'])).toBe('no liquidity')
  })

  it('measures the sampling interval as the median spacing', () => {
    expect(sampleInterval(samples('oooo'))).toBe(7200)
    expect(sampleInterval(samples('o'))).toBeNull()
  })

  it('summarises samples per UTC day, newest first (ia-v3 §4.6 "Show data")', () => {
    // 13 samples two hours apart from 00:00: 12 on the first day, 1 on the next.
    const days = dailySummary(samples('bbbbooooooouo'))
    expect(days.map((d) => d.samples)).toEqual([1, 12])
    const first = days[1]
    expect(first?.evaluable).toBe(11)
    expect(first?.withinKpi).toBe(7)
    expect(first?.minDownUsd).toBe(7_600)
    expect(days[0]?.day).toBe((first?.day ?? 0) + 86_400)
  })
})
