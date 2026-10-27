/**
 * The Token page's words (ia-v3 §4.7, docs/design/visual-v3.md §6.7): the answer, the price route
 * and the Pools takeaway, plus the one view change the butterfly needs. Values are read as stored
 * and only formatted; the answer's total is the client-side sum of the pools' ±2 % depth that
 * ia-v3 §6.4 specifies.
 */
import type { PoolMetaDto, PoolSummary, TokenDetail } from '../../api/types.js'
import { dexLabel, isPoolId, NB, pairLabel, shareOf, usd } from '../../lib/format.js'
import { swapSides } from '../../lib/orient.js'

/** The non-pool edge a route can cross, in words (ia-v3 §4.7). */
export const SOURCE_WORDS: Readonly<Record<string, string>> = {
  'wrap:weth': 'ETH to WETH',
}

/**
 * The pools as seen from `address`: a pool's sell side is token0 being sold, so where the token is
 * token1, selling it is the pool's buy side. The two stored sides swap places; nothing is
 * recomputed. The butterfly then reads "sell side, price down" as this token's price.
 */
export function orientPools(pools: readonly PoolSummary[], address: string): PoolSummary[] {
  const a = address.toLowerCase()
  return pools.map((p) =>
    p.pool.token1.address.toLowerCase() === a && p.pool.token0.address.toLowerCase() !== a
      ? swapSides(p)
      : p,
  )
}

/** "$16.5M sits within 2 % of the price across WETH’s 2 scored pools." */
export function tokenAnswer(detail: TokenDetail): string {
  const sym = detail.token.symbol
  const n = detail.pools.length
  if (n === 0) return `${sym} has no scored pools yet.`
  if (detail.usd === null)
    return `${sym} has no USD price yet, so depth is shown in pool terms only.`
  const known = detail.pools.filter((p) => p.depth2Usd !== null)
  if (!known.length) return `Depth around ${sym}’s price is not known yet.`
  const total = known.reduce((s, p) => s + (p.depth2Usd ?? 0), 0)
  const where =
    n === 1
      ? `in ${sym}’s one scored pool`
      : n < detail.total
        ? `across the ${n} deepest of ${sym}’s ${detail.total} scored pools`
        : `across ${sym}’s ${n} scored pools`
  return `${usd(total)} sits within 2${NB}% of the price ${where}.`
}

export interface RouteStep {
  source: string
  /** The pool's metadata when the observatory knows it. */
  pool?: PoolMetaDto
  /** Words for a non-pool edge ("ETH to WETH"), or the raw source when unknown. */
  words?: string
}

export function routeSteps(
  via: readonly string[],
  metas: ReadonlyMap<string, PoolMetaDto>,
): RouteStep[] {
  return via.map((source) => {
    if (isPoolId(source)) return { source, pool: metas.get(source) }
    return { source, words: SOURCE_WORDS[source] ?? source }
  })
}

/** One step in words: "WETH / USDC on Aerodrome Slipstream", "ETH to WETH". */
export function stepWords(step: RouteStep): string {
  if (step.pool)
    return `${pairLabel(step.pool.token0, step.pool.token1)} on ${dexLabel(step.pool.dex)}`
  if (step.words) return step.words
  return 'a pool not tracked here'
}

/** The Pools takeaway: the deepest pool's share of the token's depth. */
export function poolsTakeaway(pools: readonly PoolSummary[], symbol: string): string {
  const known = pools.filter((p) => p.depth2Usd !== null)
  if (!known.length) return `No ${symbol} pool has a priced depth yet.`
  const deepest = [...known].sort((a, b) => (b.depth2Usd ?? 0) - (a.depth2Usd ?? 0))[0]
  if (!deepest) return ''
  const pair = `${pairLabel(deepest.pool.token0, deepest.pool.token1)} on ${dexLabel(deepest.pool.dex)}`
  if (pools.length === 1) return `${pair} is ${symbol}’s only scored pool.`
  const total = known.reduce((s, p) => s + (p.depth2Usd ?? 0), 0)
  return `${pair} holds ${shareOf(total > 0 ? (deepest.depth2Usd ?? 0) / total : null)} of ${symbol}’s depth.`
}
