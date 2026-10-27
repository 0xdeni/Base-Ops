/**
 * Aggregation of liquidity positions into the initialised-tick list and active liquidity of a
 * concentrated pool, exactly like the pool contract does on mint: each position adds its
 * liquidity to `liquidityNet` at `tickLower`, subtracts it at `tickUpper`, adds it to
 * `liquidityGross` at both, and counts towards the active liquidity when it straddles the current
 * tick (`tickLower ≤ tick < tickUpper`).
 *
 * Shared by the test builder (`buildConcentratedState`) and the market-maker attribution
 * (`buildMmConcentratedState`) so the two can never diverge.
 */

import type { TickData } from './types.js'

/** The part of a position that decides liquidity: its tick range and liquidity. */
export interface PositionLiquidity {
  tickLower: number
  tickUpper: number
  liquidity: bigint
}

export interface AggregatedTicks {
  /** Initialised ticks (liquidityGross > 0) sorted ascending. */
  ticks: TickData[]
  /** Σ liquidity of the positions straddling `tick`. */
  liquidity: bigint
  /** Smallest tick among the positions' lower ticks and `tick`. */
  minTick: number
  /** Largest tick among the positions' upper ticks and `tick`. */
  maxTick: number
}

/**
 * Aggregates `positions` into initialised ticks and the liquidity active at `tick`.
 * Throws a RangeError for a position with `tickLower ≥ tickUpper` or negative liquidity; zero
 * liquidity positions are accepted and contribute nothing.
 */
export function aggregatePositionTicks(
  positions: readonly PositionLiquidity[],
  tick: number,
): AggregatedTicks {
  const byTick = new Map<number, TickData>()
  const bump = (index: number, net: bigint, gross: bigint) => {
    const t = byTick.get(index) ?? { index, liquidityNet: 0n, liquidityGross: 0n }
    t.liquidityNet += net
    t.liquidityGross += gross
    byTick.set(index, t)
  }
  let liquidity = 0n
  let minTick = tick
  let maxTick = tick
  for (const p of positions) {
    if (p.tickLower >= p.tickUpper) throw new RangeError('position: tickLower must be < tickUpper')
    if (p.liquidity < 0n) throw new RangeError('position: negative liquidity')
    bump(p.tickLower, p.liquidity, p.liquidity)
    bump(p.tickUpper, -p.liquidity, p.liquidity)
    if (p.tickLower <= tick && tick < p.tickUpper) liquidity += p.liquidity
    minTick = Math.min(minTick, p.tickLower)
    maxTick = Math.max(maxTick, p.tickUpper)
  }
  const ticks = [...byTick.values()]
    .filter((t) => t.liquidityGross > 0n)
    .sort((a, b) => a.index - b.index)
  return { ticks, liquidity, minTick, maxTick }
}
