/**
 * Aerodrome Slipstream (Uniswap v3 fork) on Base: the Slipstream family (./slipstreamFamily.ts)
 * over the three live CLFactory deployments of `ChainAddresses.aerodromeSlipstream`, each with its
 * own NonfungiblePositionManager (the 4-field `IncreaseLiquidity`); pool ids stay
 * `aerodrome-slipstream:<pool>`. `fee()` asks the deployment's DynamicSwapFeeModule, so it can
 * change every block; no pool checks.
 */
import type { PoolMeta } from '@depthwatch/core'
import { slipstreamNFPMAbi } from '../abi/slipstreamNFPM.js'
import type { SlipstreamDeployment } from '../addresses.js'
import { lowercase, type ReaderContext } from '../internal/context.js'
import type { DexAdapter } from '../internal/types.js'
import { type SlipstreamPoolRecord, slipstreamFamily } from './slipstreamFamily.js'

export {
  resolveStakedOwners,
  type SlipstreamPoolRecord,
  slipstreamCustodians,
} from './slipstreamFamily.js'

export const DEX = 'aerodrome-slipstream' as const

export function slipstreamPoolId(address: string): string {
  return `${DEX}:${lowercase(address)}`
}

export const aerodromeSlipstreamFamily = slipstreamFamily<SlipstreamDeployment>({
  dex: DEX,
  deployments: (ctx) => ctx.addresses.aerodromeSlipstream,
  nfpmAbi: slipstreamNFPMAbi,
})

/** PoolMeta of one Aerodrome deployment's pools (see `SlipstreamFamily.poolMetas`). */
export function slipstreamPoolMetas(
  ctx: ReaderContext,
  deployment: SlipstreamDeployment,
  records: readonly SlipstreamPoolRecord[],
): Promise<PoolMeta[]> {
  return aerodromeSlipstreamFamily.poolMetas(ctx, deployment, records)
}

export const aerodromeSlipstreamAdapter: DexAdapter = aerodromeSlipstreamFamily.adapter
