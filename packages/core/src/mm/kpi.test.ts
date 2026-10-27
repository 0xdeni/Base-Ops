import { describe, expect, it } from 'vitest'
import { evaluateKpis } from './kpi.js'
import type { MandateKpis, MmAttribution } from './types.js'

const kpis: MandateKpis = {
  minDepthUsd: 1_000,
  bandPct: 2,
  maxSpreadBps: 50,
  spreadNotionalUsd: 10_000,
  targetUptime: 0.95,
}
const noSpreadKpi: MandateKpis = { ...kpis, maxSpreadBps: null }

function attr(overrides: Partial<MmAttribution> = {}): MmAttribution {
  return {
    method: 'positions',
    holdings: 2,
    shareOfPool: 0.5,
    depthUpUsd: 5_000,
    depthDownUsd: 5_000,
    poolDepthUpUsd: 10_000,
    poolDepthDownUsd: 10_000,
    spreadBps: 20,
    poolSpreadBps: 10,
    ...overrides,
  }
}

describe('evaluateKpis', () => {
  it('rule 1: no liquidity breaches everything, spread only with a spread KPI', () => {
    const none = evaluateKpis(attr({ method: 'none', holdings: 0 }), kpis)
    expect(none).toEqual({
      withinKpi: false,
      breaches: ['noLiquidity', 'depthUp', 'depthDown', 'spread'],
    })
    expect(evaluateKpis(attr({ holdings: 0 }), kpis)).toEqual(none)
    expect(evaluateKpis(attr({ method: 'none' }), noSpreadKpi)).toEqual({
      withinKpi: false,
      breaches: ['noLiquidity', 'depthUp', 'depthDown'],
    })
    // takes precedence over unpriced depths
    expect(evaluateKpis(attr({ method: 'none', depthUpUsd: null }), kpis).withinKpi).toBe(false)
  })

  it('rule 2: an unpriced side is not evaluable', () => {
    const up = evaluateKpis(attr({ depthUpUsd: null, spreadBps: null }), kpis)
    expect(up).toEqual({ withinKpi: null, breaches: [] })
    expect(evaluateKpis(attr({ depthDownUsd: null, depthUpUsd: 0 }), kpis)).toEqual({
      withinKpi: null,
      breaches: [],
    })
  })

  it('rule 3: depth below the minimum on either side', () => {
    expect(evaluateKpis(attr({ depthUpUsd: 999.99 }), kpis)).toEqual({
      withinKpi: false,
      breaches: ['depthUp'],
    })
    expect(evaluateKpis(attr({ depthDownUsd: 0 }), kpis)).toEqual({
      withinKpi: false,
      breaches: ['depthDown'],
    })
    expect(evaluateKpis(attr({ depthUpUsd: 1, depthDownUsd: 1 }), kpis).breaches).toEqual([
      'depthUp',
      'depthDown',
    ])
    // exactly the minimum is met
    expect(evaluateKpis(attr({ depthUpUsd: 1_000, depthDownUsd: 1_000 }), kpis).withinKpi).toBe(
      true,
    )
  })

  it('rule 4: spread above the maximum or infeasible, only with a spread KPI', () => {
    expect(evaluateKpis(attr({ spreadBps: null }), kpis)).toEqual({
      withinKpi: false,
      breaches: ['spread'],
    })
    expect(evaluateKpis(attr({ spreadBps: 50.01 }), kpis).breaches).toEqual(['spread'])
    expect(evaluateKpis(attr({ spreadBps: 50 }), kpis).withinKpi).toBe(true)
    expect(evaluateKpis(attr({ spreadBps: null }), noSpreadKpi)).toEqual({
      withinKpi: true,
      breaches: [],
    })
    expect(evaluateKpis(attr({ spreadBps: 10_000 }), noSpreadKpi).withinKpi).toBe(true)
  })

  it('rule 5: within KPI only without breaches; breaches are reported in rule order', () => {
    expect(evaluateKpis(attr(), kpis)).toEqual({ withinKpi: true, breaches: [] })
    expect(evaluateKpis(attr({ depthUpUsd: 0, depthDownUsd: 0, spreadBps: null }), kpis)).toEqual({
      withinKpi: false,
      breaches: ['depthUp', 'depthDown', 'spread'],
    })
  })
})
