/**
 * Aero Slipstream on Base (`aero-slipstream`): the Slipstream family (./slipstreamFamily.ts) over
 * `ChainAddresses.aeroSlipstream`, with the Aero NFPM's ABI (its `IncreaseLiquidity` has 6 fields)
 * and swap-hook checks. A pool's `fee()` comes from its swap hook (`CLFactory.getPoolSwapHook`),
 * which fixes a block's fee at its first swap; with the reviewed DynamicSwapFeeHook and its initial
 * fee off, `fee()` at a block is what the block's next swap pays (docs/METRICS.md, "Swap fee").
 *
 * - Discovery and seeding read, with each pool's fee, `getPoolSwapHook(pool)` and the reviewed
 *   hook's `dynamicFeeConfig(pool)`. `hooks` is the pool's hook when it is not the deployment's
 *   `swapHook`, or when the hook charges the pool's first transaction of each block an initial
 *   fee (`initialFeeEnabled`, or a config that cannot be read), else null. A non-null `hooks`
 *   makes the pool hooked (core `isHookedPool`): indexed, but its depth is not modelled.
 * - Every state read sends, per deployment, `isPool`, `getPoolSwapHook` and `dynamicFeeConfig` in
 *   its first multicall. For the deployment that knows the pool the hook must still be
 *   `hooks ?? swapHook` and, when `hooks` is null, the initial fee must still be off; otherwise
 *   the read throws `PoolConfigChangedError` and the snapshot fails that pool.
 */
import type { Address } from '@depthwatch/core'
import { aeroCLFactoryAbi } from '../abi/aeroCLFactory.js'
import { aeroNFPMAbi } from '../abi/aeroNFPM.js'
import { aeroSwapHookAbi } from '../abi/aeroSwapHook.js'
import type { AeroSlipstreamDeployment } from '../addresses.js'
import { lowercase } from '../internal/context.js'
import {
  type CallResult,
  type ContractCall,
  expectResult,
  optionalResult,
} from '../internal/multicall.js'
import { PoolConfigChangedError } from '../internal/poolErrors.js'
import type { DexAdapter } from '../internal/types.js'
import { requireAddress, type StateGuard } from './shared.js'
import { type SlipstreamPoolChecks, slipstreamFamily } from './slipstreamFamily.js'

export const DEX = 'aero-slipstream' as const

export function aeroSlipstreamPoolId(address: string): string {
  return `${DEX}:${lowercase(address)}`
}

/** `getPoolSwapHook(pool)` on the factory and `dynamicFeeConfig(pool)` on the reviewed hook. */
function hookCalls(deployment: AeroSlipstreamDeployment, pool: Address): ContractCall[] {
  return [
    {
      address: deployment.factory,
      abi: aeroCLFactoryAbi,
      functionName: 'getPoolSwapHook',
      args: [pool],
    },
    {
      address: deployment.swapHook,
      abi: aeroSwapHookAbi,
      functionName: 'dynamicFeeConfig',
      args: [pool],
    },
  ]
}

/** `initialFeeEnabled` (4th output) of a `dynamicFeeConfig` answer; undefined when unreadable. */
function initialFeeEnabled(result: CallResult | undefined): boolean | undefined {
  const config = optionalResult(result)
  if (!Array.isArray(config) || typeof config[3] !== 'boolean') return undefined
  return config[3]
}

const hookChecks: SlipstreamPoolChecks<AeroSlipstreamDeployment> = {
  metaCalls: hookCalls,
  hooks(deployment, pool, [hookResult, configResult]) {
    const hook = lowercase(String(expectResult(hookResult, `${DEX} getPoolSwapHook(${pool})`)))
    if (hook !== deployment.swapHook) return hook
    return initialFeeEnabled(configResult) === false ? null : hook
  },
  stateGuard(deployments, pool): StateGuard {
    const address = requireAddress(pool)
    return {
      calls: deployments.flatMap((d) => [
        { address: d.factory, abi: aeroCLFactoryAbi, functionName: 'isPool', args: [address] },
        ...hookCalls(d, address),
      ]),
      check(results) {
        const i = deployments.findIndex(
          (_, j) => expectResult(results[j * 3], `${pool.id} isPool`) === true,
        )
        const deployment = deployments[i]
        if (deployment === undefined)
          throw new Error(`${pool.id}: no ${DEX} factory reports it as its pool (isPool)`)
        const hook = lowercase(
          String(expectResult(results[i * 3 + 1], `${pool.id} getPoolSwapHook`)),
        )
        if (hook !== lowercase(pool.hooks ?? deployment.swapHook))
          throw new PoolConfigChangedError(pool.id, 'swap hook changed', hook)
        if (pool.hooks !== null) return
        expectResult(results[i * 3 + 2], `${pool.id} dynamicFeeConfig`)
        if (initialFeeEnabled(results[i * 3 + 2]) !== false)
          throw new PoolConfigChangedError(pool.id, 'initial fee enabled')
      },
    }
  },
}

export const aeroSlipstreamFamily = slipstreamFamily<AeroSlipstreamDeployment>({
  dex: DEX,
  deployments: (ctx) => ctx.addresses.aeroSlipstream,
  nfpmAbi: aeroNFPMAbi,
  checks: hookChecks,
})

/** PoolMeta of one Aero deployment's pools, `hooks` included (see the header). */
export const aeroSlipstreamPoolMetas: typeof aeroSlipstreamFamily.poolMetas = (
  ctx,
  deployment,
  records,
) => aeroSlipstreamFamily.poolMetas(ctx, deployment, records)

export const aeroSlipstreamAdapter: DexAdapter = aeroSlipstreamFamily.adapter
