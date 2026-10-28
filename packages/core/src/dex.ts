/**
 * Facts that follow from a pool's DEX id alone (docs/METRICS.md, Conventions, "Swap fee").
 */
import type { Dex } from './types.js'

/**
 * DEXes whose pools read their LP fee at every block. A Slipstream pool's `fee()` asks a
 * module that can change it from one block to the next: a DynamicSwapFeeModule on all three
 * Aerodrome deployments, the swap hook on Aero. Depth and spread use the fee read at the
 * snapshot's block (`PoolSnapshot.feePips`); `PoolMeta.feePips` is the latest snapshot's (the
 * reading at discovery for a pool never snapshotted).
 */
export const DYNAMIC_FEE_DEXES = [
  'aerodrome-slipstream',
  'aero-slipstream',
] as const satisfies readonly Dex[]

/** True when the pool's DEX is one of `DYNAMIC_FEE_DEXES`: its fee is a reading, not a tier. */
export function hasDynamicFee(pool: { dex: string }): boolean {
  return (DYNAMIC_FEE_DEXES as readonly string[]).includes(pool.dex)
}
