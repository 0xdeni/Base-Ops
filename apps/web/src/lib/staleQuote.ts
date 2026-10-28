/**
 * A stale quote in plain words (docs/METRICS.md, "Stale quotes"): what the chip says and the line
 * its tooltip gives. Formatting only: the flag and the deviation come from the API and core.
 */
import { STALE_QUOTE_MIN_DEVIATION_BPS } from '@depthwatch/core'
import { NB } from './format.js'

/** What the chip says beside a stale quote's depth. */
export const STALE_PRICE = 'Stale price'

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/**
 * "Stale price: 386,013 % off the market, so its depth is left out of totals."; without a known
 * deviation the line names the 5 % threshold instead.
 */
export function staleQuoteDetail(deviationBps: number | null): string {
  const off =
    deviationBps === null
      ? `${STALE_QUOTE_MIN_DEVIATION_BPS / 100}${NB}% or more`
      : `${GROUPED.format(deviationBps / 100)}${NB}%`
  return `${STALE_PRICE}: ${off} off the market, so its depth is left out of totals.`
}
