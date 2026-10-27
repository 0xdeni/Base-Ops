/**
 * Which way a pool's price reads (principles N2, ia-v3 §4.3). The API stores every price as token1
 * per token0 and every side from token0's point of view (up = buying token0, AGENTS.md rule 6), and
 * every page keeps those sides as stored, so a pool shows the same sell and buy values on Home,
 * Pools, its own page and its scorecards, under its token0 / token1 name.
 *
 * Only the price line turns: a pool whose price is below 1 (USDC / AERO: 0.795 AERO per USDC)
 * shows its price from token1 ("1 AERO = 1.258 USDC"), so a price below 1 only shows behind the ⇄
 * toggle. Nothing here is a metric.
 */
import type { PoolSummary } from '../api/types.js'

/** True when the price line starts from token1: the stored price (token1 per token0) is below 1. */
export function isInverted(price: number | null | undefined): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0 && price < 1
}

/** The token the price line starts from (base) and the one it is quoted in, as presented. */
export function baseQuote<T>(
  pool: { token0: T; token1: T },
  price: number | null | undefined,
): { base: T; quote: T; inverted: boolean } {
  return isInverted(price)
    ? { base: pool.token1, quote: pool.token0, inverted: true }
    : { base: pool.token0, quote: pool.token1, inverted: false }
}

/** The pool's price in quote per base: the stored price, or its inverse for an inverted pool. */
export function basePrice(price: number | null | undefined): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  return isInverted(price) ? 1 / price : price
}

/**
 * A summary with its stored sides swapped: what selling and buying the other token meets. Only the
 * Token page uses it, where every pool is seen from the page's token ("sell side, price down" is
 * that token's price).
 */
export function swapSides(p: PoolSummary): PoolSummary {
  return { ...p, depth2UpUsd: p.depth2DownUsd, depth2DownUsd: p.depth2UpUsd }
}
