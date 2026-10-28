/**
 * Depth at ±p %: the input needed to move the pool's price by p percent on each side.
 *
 * up   = simulateSwapToPrice(state, mid·(1 + p/100)) — buyers of token0 pay token1;
 * down = simulateSwapToPrice(state, mid·(1 − p/100)) — sellers of token0 pay token0.
 * USD = amountIn × token USD price (human units).
 */

import { rawToHuman } from '../math.js'
import { simulateSwapToPrice } from '../swap/index.js'
import { midPrice } from '../swap/midPrice.js'
import {
  DEPTH_LEVELS_PCT,
  type DepthLevel,
  type DepthLevelUsd,
  type DepthSide,
  type PoolState,
  type SwapResult,
  type TokenInfo,
} from '../types.js'

const EMPTY_SIDE: Readonly<DepthSide> = Object.freeze({
  amountIn: 0n,
  amountOut: 0n,
  reached: false,
})

function toSide(result: SwapResult): DepthSide {
  return { amountIn: result.amountIn, amountOut: result.amountOut, reached: result.complete }
}

/**
 * Depth levels for the given percent moves (default 1, 2, 5). For an empty pool (no usable mid
 * price) every side is zero and unreached.
 */
export function computeDepth(
  state: PoolState,
  decimals0: number,
  decimals1: number,
  pcts: readonly number[] = DEPTH_LEVELS_PCT,
): DepthLevel[] {
  const mid = midPrice(state, decimals0, decimals1)
  const usable = Number.isFinite(mid) && mid > 0
  const decimals = { decimals0, decimals1 }
  return pcts.map((pct) => {
    if (!usable || !(pct > 0) || pct >= 100)
      return { pct, up: { ...EMPTY_SIDE }, down: { ...EMPTY_SIDE } }
    const up = simulateSwapToPrice(state, mid * (1 + pct / 100), decimals)
    const down = simulateSwapToPrice(state, mid * (1 - pct / 100), decimals)
    return { pct, up: toSide(up), down: toSide(down) }
  })
}

/** Converts depth levels to USD: up side is token1 in, down side is token0 in. */
export function depthToUsd(
  levels: DepthLevel[],
  token0: TokenInfo,
  token1: TokenInfo,
  token0Usd: number | null,
  token1Usd: number | null,
): DepthLevelUsd[] {
  return levels.map((level) => {
    const upUsd =
      token1Usd === null ? null : rawToHuman(level.up.amountIn, token1.decimals) * token1Usd
    const downUsd =
      token0Usd === null ? null : rawToHuman(level.down.amountIn, token0.decimals) * token0Usd
    const totalUsd =
      upUsd !== null && downUsd !== null ? upUsd + downUsd : upUsd !== null ? upUsd : downUsd
    return { pct: level.pct, upUsd, downUsd, totalUsd }
  })
}

/**
 * A pool's quote is stale from this deviation (bps) between its price and the price its tokens'
 * USD prices imply (docs/METRICS.md, "Stale quotes").
 */
export const STALE_QUOTE_MIN_DEVIATION_BPS = 500

/**
 * `|price / (token0Usd / token1Usd) − 1| × 10 000`: how far the pool's price (token1 per token0)
 * is from the one its tokens' USD prices imply. Null when either USD price (or the price) is
 * missing, zero or not finite.
 */
export function priceDeviationBps(
  price: number,
  token0Usd: number | null,
  token1Usd: number | null,
): number | null {
  const usable = (x: number | null): x is number => x !== null && Number.isFinite(x) && x > 0
  if (!usable(price) || !usable(token0Usd) || !usable(token1Usd)) return null
  const deviation = Math.abs((price * token1Usd) / token0Usd - 1) * 10_000
  return Number.isFinite(deviation) ? deviation : null
}

/** True when a known deviation reaches `STALE_QUOTE_MIN_DEVIATION_BPS`; unknown is not stale. */
export function isStaleQuote(deviationBps: number | null): boolean {
  return deviationBps !== null && deviationBps >= STALE_QUOTE_MIN_DEVIATION_BPS
}
