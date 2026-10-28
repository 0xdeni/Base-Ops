/**
 * The Pools explorer's sentences (ia-v3 §4.2, docs/design/visual-v4.md §6.3). Every number comes
 * from the API (`/api/stats` sums and medians from core); the page only words them.
 */
import { type Dex, healthGrade } from '@depthwatch/core'
import type { StatsResponse } from '../../api/types.js'
import { dexLabel, NB, score, usd } from '../../lib/format.js'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * The filter-aware answer: "6 pools on 4 DEXes hold $26.1M within 2 % of the price." or, for one
 * DEX, "Uniswap v3: 2 pools, $9.30M within 2 % of the price, median health 79 (B)."
 */
export function poolsAnswer(stats: StatsResponse, dex: Dex | ''): string {
  if (dex) {
    const row = stats.byDex.find((d) => d.dex === dex)
    const name = dexLabel(dex)
    if (!row || row.scored === 0) return `${name}: no pools are scored yet.`
    const head = `${name}: ${row.scored} ${plural(row.scored, 'pool', 'pools')}, ${usd(row.depth2Usd)} within 2${NB}% of the price`
    if (row.medianHealth === null) return `${head}, none rated yet.`
    return `${head}, median health ${score(row.medianHealth)} (${healthGrade(row.medianHealth)}) across ${row.rated} rated.`
  }
  const n = stats.totals.scored
  if (n === 0) return 'No pools are scored yet.'
  const dexes = stats.byDex.filter((d) => d.scored > 0).length
  return `${n} ${plural(n, 'pool', 'pools')} on ${dexes} ${plural(dexes, 'DEX', 'DEXes')} ${plural(n, 'holds', 'hold')} ${usd(stats.totals.depth2Usd)} within 2${NB}% of the price.`
}

/**
 * The caption's count of the rated pools, announced politely: "50 rated pools", or "Showing 2 of 50"
 * under a filter. `all` is the number of rated pools in the stats. With the unrated pools open it
 * adds how many are on screen, so opening and hiding them are both announced: "50 rated pools, plus
 * 50 of 442 unrated".
 */
export function poolsCount(
  total: number,
  all: number | undefined,
  filtered: boolean,
  unrated?: { shown: number; total: number },
): string {
  const rated =
    filtered && all !== undefined
      ? `Showing ${total} of ${all} rated`
      : `${total} rated ${plural(total, 'pool', 'pools')}`
  if (!unrated || unrated.shown === 0) return rated
  const of = unrated.shown < unrated.total ? `${unrated.shown} of ${unrated.total}` : unrated.total
  return `${rated}, plus ${of} unrated`
}

/** The row that opens the unrated pools: "Show 442 unrated pools". */
export function showUnratedLabel(n: number): string {
  return `Show ${n} unrated ${plural(n, 'pool', 'pools')}`
}
