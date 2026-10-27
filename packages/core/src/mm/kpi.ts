/**
 * KPI evaluation of one market-maker sample (docs/design/scorecards.md §2), rules in order:
 * 1. method 'none' or no holdings → noLiquidity + depthUp + depthDown (+ spread when a spread
 *    KPI is set), withinKpi = false.
 * 2. an unpriced depth side → withinKpi = null, no breaches (not evaluable).
 * 3. depthUpUsd < minDepthUsd → depthUp; depthDownUsd < minDepthUsd → depthDown.
 * 4. a spread KPI and (spreadBps null or > maxSpreadBps) → spread.
 * 5. withinKpi = no breaches.
 */

import type { BreachKind, MandateKpis, MmAttribution } from './types.js'

export interface KpiEvaluation {
  /** true = every KPI met; false = at least one breach; null = not evaluable (unpriced). */
  withinKpi: boolean | null
  breaches: BreachKind[]
}

export function evaluateKpis(attr: MmAttribution, kpis: MandateKpis): KpiEvaluation {
  if (attr.method === 'none' || attr.holdings === 0) {
    const breaches: BreachKind[] = ['noLiquidity', 'depthUp', 'depthDown']
    if (kpis.maxSpreadBps !== null) breaches.push('spread')
    return { withinKpi: false, breaches }
  }
  if (attr.depthUpUsd === null || attr.depthDownUsd === null)
    return { withinKpi: null, breaches: [] }
  const breaches: BreachKind[] = []
  if (attr.depthUpUsd < kpis.minDepthUsd) breaches.push('depthUp')
  if (attr.depthDownUsd < kpis.minDepthUsd) breaches.push('depthDown')
  if (kpis.maxSpreadBps !== null && (attr.spreadBps === null || attr.spreadBps > kpis.maxSpreadBps))
    breaches.push('spread')
  return { withinKpi: breaches.length === 0, breaches }
}
