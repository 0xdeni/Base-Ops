/**
 * Effective spread at a USD notional, fees included.
 *
 * buy:  N USD of token1 in, exact-in oneForZero → buyAvg  = amount1In / amount0Out
 * sell: N USD of token0 in, exact-in zeroForOne → sellAvg = amount1Out / amount0In
 * spreadBps = (buyAvg − sellAvg) / mid × 1e4 (human prices) = buy impact + sell impact, where
 * buyImpact = buyAvg / mid − 1 and sellImpact = 1 − sellAvg / mid. Infeasible (null) when either
 * leg is incomplete, yields nothing, a USD price is missing, or a leg's price impact is above
 * SPREAD_MAX_LEG_IMPACT_BPS: constant-product and stable legs never run out of liquidity, so
 * "complete" alone lets a trade into a dust pool publish a spread of 1e24 bps (docs/METRICS.md,
 * "Effective spread").
 */

import { humanToRaw, rawToHuman } from '../math.js'
import { simulateSwapExactIn } from '../swap/index.js'
import { midPrice } from '../swap/midPrice.js'
import { type PoolState, SPREAD_NOTIONALS_USD, type SpreadPoint, type TokenInfo } from '../types.js'

/** A leg whose average price is more than this far from mid (50 %) did not absorb the trade. */
export const SPREAD_MAX_LEG_IMPACT_BPS = 5_000

/** True when both legs' average prices are within SPREAD_MAX_LEG_IMPACT_BPS of `mid`. */
function legsWithinCap(buyAvgPrice: number, sellAvgPrice: number, mid: number): boolean {
  const buyImpactBps = (buyAvgPrice / mid - 1) * 1e4
  const sellImpactBps = (1 - sellAvgPrice / mid) * 1e4
  return buyImpactBps <= SPREAD_MAX_LEG_IMPACT_BPS && sellImpactBps <= SPREAD_MAX_LEG_IMPACT_BPS
}

/**
 * The spread of a stored point under today's feasibility rules: null when the point is
 * infeasible or a leg's price impact is above the cap, which a point stored before the cap
 * existed can be (1e24 bps on a dust pool). `mid` is the snapshot's price.
 */
export function feasibleSpreadBps(point: SpreadPoint | undefined, mid: number): number | null {
  if (!point?.feasible) return null
  const { spreadBps, buyAvgPrice, sellAvgPrice } = point
  if (spreadBps === null || buyAvgPrice === null || sellAvgPrice === null) return null
  return legsWithinCap(buyAvgPrice, sellAvgPrice, mid) ? spreadBps : null
}

function infeasible(notionalUsd: number): SpreadPoint {
  return { notionalUsd, spreadBps: null, feasible: false, buyAvgPrice: null, sellAvgPrice: null }
}

export function computeEffectiveSpread(
  state: PoolState,
  token0: TokenInfo,
  token1: TokenInfo,
  token0Usd: number | null,
  token1Usd: number | null,
  notionalsUsd: readonly number[] = SPREAD_NOTIONALS_USD,
): SpreadPoint[] {
  const mid = midPrice(state, token0.decimals, token1.decimals)
  const priced =
    token0Usd !== null && token1Usd !== null && token0Usd > 0 && token1Usd > 0 && mid > 0
  return notionalsUsd.map((notionalUsd) => {
    if (!priced || !(notionalUsd > 0) || !Number.isFinite(notionalUsd))
      return infeasible(notionalUsd)
    const amount1In = humanToRaw(notionalUsd / token1Usd, token1.decimals)
    const amount0In = humanToRaw(notionalUsd / token0Usd, token0.decimals)
    if (amount1In <= 0n || amount0In <= 0n) return infeasible(notionalUsd)
    const buy = simulateSwapExactIn(state, 'oneForZero', amount1In)
    const sell = simulateSwapExactIn(state, 'zeroForOne', amount0In)
    // Either leg yielding nothing (output rounds to 0 raw units) makes the spread meaningless.
    if (!buy.complete || !sell.complete || buy.amountOut === 0n || sell.amountOut === 0n)
      return infeasible(notionalUsd)
    const buyAvgPrice =
      rawToHuman(buy.amountIn, token1.decimals) / rawToHuman(buy.amountOut, token0.decimals)
    const sellAvgPrice =
      rawToHuman(sell.amountOut, token1.decimals) / rawToHuman(sell.amountIn, token0.decimals)
    const spreadBps = ((buyAvgPrice - sellAvgPrice) / mid) * 1e4
    if (!Number.isFinite(spreadBps)) return infeasible(notionalUsd)
    if (!legsWithinCap(buyAvgPrice, sellAvgPrice, mid)) return infeasible(notionalUsd)
    return { notionalUsd, spreadBps, feasible: true, buyAvgPrice, sellAvgPrice }
  })
}
