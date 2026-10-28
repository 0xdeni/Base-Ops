/**
 * Test-only helpers for the Aero DEXes, hand-built from the ABI encodings with the values read on
 * Base (docs/research/base-contracts.md §2.9): the v2 factories' fee reads, v2 and CL pools, the
 * swap hook, FactoryRegistry gauges, and a transport that records which functions each request
 * asked of which contract (Multicall3 `aggregate3` calls one by one).
 */
import type { Address, Hex, PoolMeta } from '@depthwatch/core'
import { type Abi, custom, decodeFunctionData, type Transport, toFunctionSelector } from 'viem'
import { aeroCLFactoryAbi } from '../abi/aeroCLFactory.js'
import { aerodromeGaugeAbi } from '../abi/aerodromeGauge.js'
import { aeroFactoryRegistryAbi } from '../abi/aeroFactoryRegistry.js'
import { aeroPoolFactoryAbi } from '../abi/aeroPoolFactory.js'
import { aeroSwapHookAbi } from '../abi/aeroSwapHook.js'
import { multicall3Abi } from '../abi/multicall3.js'
import { type AeroSlipstreamDeployment, BASE_ADDRESSES } from '../addresses.js'
import { type BlockRef, registerCall } from '../fixtures/builders.js'
import type { Fixture } from '../transport/fixture.js'
import { type ConcentratedSpec, registerConcentratedPool, registerV2Pool, ZERO } from './helpers.js'

export const AERO_V2 = BASE_ADDRESSES.aeroV2
export const AERO_CL = BASE_ADDRESSES.aeroSlipstream[0] as AeroSlipstreamDeployment

/** The WETH/USDC tick-spacing-50 pool's hook config (base-contracts.md §2.9). */
export const WETH_USDC_HOOK_CONFIG = Object.freeze({
  baseFee: 225,
  feeCap: 5_000,
  scalingFactor: 30_000_000n,
})

/** `feeModule()` of both Aero v2 factories: the pinned modules unless given others. */
export function registerAeroV2Factory(
  fixture: Fixture,
  opts: { volatileModule?: Address; stableModule?: Address; blocks?: BlockRef[] } = {},
): void {
  const blocks = opts.blocks ?? ['latest']
  for (const [to, result] of [
    [AERO_V2.volatileFactory, opts.volatileModule ?? AERO_V2.volatileFeeModule],
    [AERO_V2.stableFactory, opts.stableModule ?? AERO_V2.stableFeeModule],
  ] as const)
    registerCall(fixture, {
      to,
      abi: aeroPoolFactoryAbi,
      functionName: 'feeModule',
      result,
      blocks,
    })
}

/** An Aero v2 pool's reserves and its factory's `getBaseFee(pool, 0x0, 0, 0, 0, 0)` (bps). */
export function registerAeroV2Pool(
  fixture: Fixture,
  pool: PoolMeta,
  spec: { reserve0: bigint; reserve1: bigint; feeBps: bigint },
  blocks: BlockRef[] = ['latest'],
): void {
  registerV2Pool(fixture, pool, spec, blocks)
  registerCall(fixture, {
    to: pool.stable ? AERO_V2.stableFactory : AERO_V2.volatileFactory,
    abi: aeroPoolFactoryAbi,
    functionName: 'getBaseFee',
    args: [pool.address as Address, ZERO, 0n, 0n, 0n, 0n],
    result: spec.feeBps,
    blocks,
  })
}

export interface AeroHookSpec {
  /** `getPoolSwapHook(pool)` (default: the reviewed hook). */
  hook?: Address
  initialFeeEnabled?: boolean
  /** `isPool(pool)` on the factory (default true). */
  isPool?: boolean
  blocks?: BlockRef[]
}

/** `isPool`, `getPoolSwapHook` on the CLFactory and `dynamicFeeConfig` on the reviewed hook. */
export function registerAeroHook(fixture: Fixture, pool: Address, spec: AeroHookSpec = {}): void {
  const blocks = spec.blocks ?? ['latest']
  const factory = { to: AERO_CL.factory, abi: aeroCLFactoryAbi, args: [pool], blocks }
  registerCall(fixture, { ...factory, functionName: 'isPool', result: spec.isPool ?? true })
  registerCall(fixture, {
    ...factory,
    functionName: 'getPoolSwapHook',
    result: spec.hook ?? AERO_CL.swapHook,
  })
  const c = WETH_USDC_HOOK_CONFIG
  registerCall(fixture, {
    to: AERO_CL.swapHook,
    abi: aeroSwapHookAbi,
    functionName: 'dynamicFeeConfig',
    args: [pool],
    result: [c.baseFee, c.feeCap, c.scalingFactor, spec.initialFeeEnabled ?? false, 0],
    blocks,
  })
}

/** An Aero Slipstream pool's state reads and its hook reads at the same blocks. */
export function registerAeroCLPool(
  fixture: Fixture,
  pool: PoolMeta,
  spec: ConcentratedSpec,
  hook: AeroHookSpec = {},
  blocks: BlockRef[] = ['latest'],
): void {
  registerConcentratedPool(fixture, pool, spec, blocks)
  registerAeroHook(fixture, pool.address as Address, { ...hook, blocks })
}

/** `FactoryRegistry.targetToGauge(pool)` and the gauge's `balanceOf` per owner. */
export function registerAeroGauge(
  fixture: Fixture,
  pool: Address,
  gauge: Address,
  staked: Readonly<Record<Address, bigint>> = {},
  blocks: BlockRef[] = ['latest'],
): void {
  registerCall(fixture, {
    to: AERO_V2.factoryRegistry,
    abi: aeroFactoryRegistryAbi,
    functionName: 'targetToGauge',
    args: [pool],
    result: gauge,
    blocks,
  })
  for (const [owner, balance] of Object.entries(staked))
    registerCall(fixture, {
      to: gauge,
      abi: aerodromeGaugeAbi,
      functionName: 'balanceOf',
      args: [owner],
      result: balance,
      blocks,
    })
}

/** `<contract>:<selector>` of a function, as `callRecorder` records it. */
export function callOf(to: Address, abi: Abi, name: string): string {
  const item = abi.find((i) => i.type === 'function' && i.name === name)
  if (item === undefined) throw new Error(`no function ${name}`)
  return `${to.toLowerCase()}:${toFunctionSelector(item as Parameters<typeof toFunctionSelector>[0])}`
}

/**
 * Wraps a transport and records, per `eth_call` request, the `<contract>:<selector>` of every
 * call it carries (each call of a Multicall3 `aggregate3`).
 */
export function callRecorder(inner: Transport): { transport: Transport; requests: string[][] } {
  const requests: string[][] = []
  const transport: Transport = (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_call') {
        const [call] = params as [{ to: Address; data: Hex }]
        if (call.data.startsWith('0x82ad56cb')) {
          const { args } = decodeFunctionData({ abi: multicall3Abi, data: call.data })
          const calls = (args?.[0] ?? []) as readonly { target: Address; callData: Hex }[]
          requests.push(calls.map((c) => `${c.target.toLowerCase()}:${c.callData.slice(0, 10)}`))
        } else requests.push([`${call.to.toLowerCase()}:${call.data.slice(0, 10)}`])
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'recorder', name: 'Recorder', retryCount: 0 })(config)
  }
  return { transport, requests }
}
