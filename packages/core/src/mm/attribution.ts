/**
 * Market-maker attribution (layer 2, pure): the liquidity a mandate's addresses provide, measured
 * with the very same depth and spread code as the whole pool.
 *
 * - Concentrated pools: a state containing ONLY the market maker's positions (ticks rebuilt from
 *   their liquidity deltas, active liquidity = Σ liquidity of the positions straddling the tick,
 *   price / fee / spacing / bounds / block copied from the pool).
 * - Reserve pools (Aerodrome v2): the pool's reserves scaled by the market maker's share of the LP
 *   supply (wallet balance + gauge-staked).
 * - `shareOfPool`: the market maker's share of the pool's in-band liquidity weight, using the
 *   weighting of metrics/concentration.ts (`liquidity × clipped (√Pupper − √Plower)`).
 */

import { minBigint, WAD } from '../math.js'
import {
  bandSqrtBounds,
  clipBandToKnownTicks,
  poolBandWeight,
  positionsBandWeight,
} from '../metrics/concentration.js'
import { computeDepth, depthToUsd } from '../metrics/depth.js'
import { computeEffectiveSpread } from '../metrics/spread.js'
import { aggregatePositionTicks } from '../positionTicks.js'
import type {
  Address,
  ConcentratedState,
  ConstantProductState,
  PoolState,
  Position,
  StableSwapState,
  TokenInfo,
} from '../types.js'
import type { AttributionMethod, LpHolding, MandateKpis, MmAttribution } from './types.js'

/** Positions whose owner is one of `addresses` (compared case-insensitively), in input order. */
export function filterPositionsByOwners(
  positions: readonly Position[],
  addresses: readonly Address[],
): Position[] {
  const wanted = new Set(addresses.map((a) => a.toLowerCase()))
  return positions.filter((p) => wanted.has(p.owner.toLowerCase()))
}

/**
 * A concentrated state that contains ONLY `positions`: ticks rebuilt from their tickLower /
 * tickUpper liquidity deltas, active liquidity = Σ liquidity of the positions straddling
 * `state.tick`; sqrtPriceX96, tick, fee, tickSpacing, bounds and block are those of `state`.
 * Throws a RangeError for a position with `tickLower ≥ tickUpper` or negative liquidity.
 */
export function buildMmConcentratedState(
  state: ConcentratedState,
  positions: readonly Position[],
): ConcentratedState {
  const { ticks, liquidity } = aggregatePositionTicks(positions, state.tick)
  return { ...state, ticks, liquidity }
}

/**
 * The market maker's share of the LP supply: Σ(balance + staked) / totalSupply, as an exact
 * fraction clamped to [0, 1]. All holdings describe the same pool at the same block, so the
 * first one's totalSupply is the denominator. Null without holdings or when totalSupply = 0.
 */
export function lpShare(holdings: readonly LpHolding[]): { num: bigint; den: bigint } | null {
  const den = holdings[0]?.totalSupply ?? 0n
  if (den <= 0n) return null
  let num = 0n
  for (const h of holdings) num += h.balance + h.staked
  return { num: num < 0n ? 0n : minBigint(num, den), den }
}

/**
 * A reserve-pool state holding the market maker's share of each reserve (floored). Without a
 * share (no holdings or an empty LP supply) both reserves are 0n.
 */
export function buildMmReserveState(
  state: ConstantProductState | StableSwapState,
  holdings: readonly LpHolding[],
): ConstantProductState | StableSwapState {
  const share = lpShare(holdings)
  const scale = (reserve: bigint): bigint =>
    share === null ? 0n : (reserve * share.num) / share.den
  return { ...state, reserve0: scale(state.reserve0), reserve1: scale(state.reserve1) }
}

/** `lpShare` as a number in 0..1 (null when unknown). */
export function lpShareOfPool(holdings: readonly LpHolding[]): number | null {
  const share = lpShare(holdings)
  return share === null ? null : Number((share.num * WAD) / share.den) / 1e18
}

/**
 * The market maker's share of the pool's in-band liquidity weight at ±bandPct:
 * `positionsBandWeight(positions) / poolBandWeight(state)` with the band clipped to the known
 * ticks on both sides, clamped to 1. Null when the pool has no in-band weight.
 */
export function positionsShareOfPool(
  state: ConcentratedState,
  positions: readonly Position[],
  bandPct: number,
): number | null {
  const band = bandSqrtBounds(state.sqrtPriceX96, bandPct)
  const total = poolBandWeight(state, band)
  if (total <= 0n) return null
  const mine = positionsBandWeight(positions, clipBandToKnownTicks(state, band))
  return Number((minBigint(mine, total) * WAD) / total) / 1e18
}

export interface AttributionInput {
  token0: TokenInfo
  token1: TokenInfo
  token0Usd: number | null
  token1Usd: number | null
  /** Whole pool at the snapshot block. */
  state: PoolState
  /** Market-maker-only state (null when the market maker holds nothing). */
  mmState: PoolState | null
  method: AttributionMethod
  /** Positions or LP holdings counted for the market maker. */
  holdings: number
  shareOfPool: number | null
  kpis: MandateKpis
}

interface Measured {
  upUsd: number | null
  downUsd: number | null
  spreadBps: number | null
}

/** Depth at ±bandPct (USD per side) and the effective spread at spreadNotionalUsd of one state. */
function measure(input: AttributionInput, state: PoolState): Measured {
  const { token0, token1, token0Usd, token1Usd, kpis } = input
  const levels = computeDepth(state, token0.decimals, token1.decimals, [kpis.bandPct])
  const usd = depthToUsd(levels, token0, token1, token0Usd, token1Usd)[0]
  const spread = computeEffectiveSpread(state, token0, token1, token0Usd, token1Usd, [
    kpis.spreadNotionalUsd,
  ])[0]
  return {
    upUsd: usd?.upUsd ?? null,
    downUsd: usd?.downUsd ?? null,
    spreadBps: spread?.spreadBps ?? null,
  }
}

/**
 * Depth and spread of the market maker's liquidity next to the whole pool's, both measured with
 * `computeDepth` / `depthToUsd` at `kpis.bandPct` and `computeEffectiveSpread` at
 * `kpis.spreadNotionalUsd`. Without an `mmState` the market-maker depths are 0 on every priced
 * side (null on an unpriced one), the spread is null and `holdings` is 0.
 */
export function computeMmAttribution(input: AttributionInput): MmAttribution {
  const pool = measure(input, input.state)
  const mm = input.mmState === null ? null : measure(input, input.mmState)
  return {
    method: input.method,
    holdings: mm === null ? 0 : input.holdings,
    shareOfPool: input.shareOfPool,
    depthUpUsd: mm === null ? (input.token1Usd === null ? null : 0) : mm.upUsd,
    depthDownUsd: mm === null ? (input.token0Usd === null ? null : 0) : mm.downUsd,
    poolDepthUpUsd: pool.upUsd,
    poolDepthDownUsd: pool.downUsd,
    spreadBps: mm === null ? null : mm.spreadBps,
    poolSpreadBps: pool.spreadBps,
  }
}
