/**
 * The Aero side of the synthetic Base world: an Aero v2 volatile AERO (Aero)/USDC pool whose gauge
 * the FactoryRegistry knows, and an Aero Slipstream WETH/USDC pool (tick spacing 50) on the
 * reviewed swap hook, most of whose NFTs are staked in its CLGauge. Values follow the reads in
 * docs/research/base-contracts.md §2.9 (the WETH/USDC hook config: base fee 225, cap 5 000 pips).
 *
 * The demo dates the Aero factories earlier than Base did: `syntheticAddresses(anchor)` is
 * `BASE_ADDRESSES` with both Aero start blocks `SYNTHETIC_AERO_START_OFFSET` blocks before the
 * anchor, inside the world's pre-history, and the Aero pools are created after that and before
 * the oldest epoch and the position mints, so the demo's seven days of history hold them.
 * `BASE_ADDRESSES` keeps the real start blocks; every factory address is the real one.
 *
 * The Aero Slipstream pool's fee is a reading of the hour in the time-varying world (the hook's
 * base fee plus a volatility part, `aeroHookFeeAt`) and 465 pips in the static world.
 */
import type { Address, PoolMeta } from '@depthwatch/core'
import { aeroCLFactoryAbi } from '../abi/aeroCLFactory.js'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromePoolAbi } from '../abi/aerodromePool.js'
import { aeroFactoryRegistryAbi } from '../abi/aeroFactoryRegistry.js'
import { aeroPoolFactoryAbi } from '../abi/aeroPoolFactory.js'
import { aeroSwapHookAbi } from '../abi/aeroSwapHook.js'
import { BASE_ADDRESSES, type ChainAddresses, TOKENS } from '../addresses.js'
import type { Fixture, FixtureLog } from '../transport/fixture.js'
import { type BlockRef, makeLog, registerCall, registerRevert } from './builders.js'
import type { ConcentratedSpec, V2Spec } from './syntheticBuild.js'
import { unitNoise } from './syntheticTime.js'
import {
  AERO_SLIPSTREAM_FACTORY_INDEX,
  SYNTHETIC_POOL_LABELS as L,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_PRICES,
  type SyntheticConcentratedPool,
  type SyntheticV2Pool,
  ZERO_ADDRESS,
} from './syntheticTypes.js'

const E18 = 10n ** 18n
const { ETH, AERO, USD } = SYNTHETIC_PRICES

/** The synthetic Aero factories start this many blocks before the anchor. */
export const SYNTHETIC_AERO_START_OFFSET = 1_000_000n

/** The reviewed hook's `dynamicFeeConfig` of the synthetic Aero Slipstream pool. */
export const SYNTHETIC_AERO_HOOK_CONFIG = Object.freeze({
  baseFee: 225,
  feeCap: 5_000,
  scalingFactor: 30_000_000n,
  initialFeeEnabled: false,
  initialFee: 0,
})

/** The span of the volatility part of the synthetic hook fee (225 … 2 055 pips). */
const AERO_HOOK_DYNAMIC_SPAN = 1_830

/** The Aero Slipstream pool's fee during `hour` of the time-varying world (pips, below the cap). */
export function aeroHookFeeAt(seed: number, poolIndex: number, hour: number): number {
  const { baseFee, feeCap } = SYNTHETIC_AERO_HOOK_CONFIG
  const fee = baseFee + Math.round(AERO_HOOK_DYNAMIC_SPAN * unitNoise(seed, 60, poolIndex, hour))
  return Math.min(fee, feeCap)
}

/** `BASE_ADDRESSES` with the Aero start blocks inside the synthetic world's pre-history. */
export function syntheticAddresses(
  anchorBlock: bigint = SYNTHETIC_DEFAULTS.latestBlock,
): ChainAddresses {
  const startBlock =
    anchorBlock > SYNTHETIC_AERO_START_OFFSET ? anchorBlock - SYNTHETIC_AERO_START_OFFSET : 1n
  return {
    ...BASE_ADDRESSES,
    aeroV2: { ...BASE_ADDRESSES.aeroV2, startBlock },
    aeroSlipstream: BASE_ADDRESSES.aeroSlipstream.map((d) => ({ ...d, startBlock })),
  }
}

/** The two Aero pools, appended to the world's specs (pool indices 6 and 7). */
export const SYNTHETIC_AERO_V2_SPEC: V2Spec = {
  label: L.aeroUsdcAeroV2,
  dex: 'aero-v2',
  token0: TOKENS.AERO,
  token1: TOKENS.USDC,
  stable: false,
  feeBps: 30n,
  reserve0: 800_000n * E18,
  reserve1: 960_000n * 10n ** 6n,
  createdOffset: 950_000n,
  activity: { volumeUsd: 900_000, swapCount: 50, token0Usd: AERO, token1Usd: USD },
  holders: [{ owner: 2, walletPct: 15, stakedPct: 35 }],
}

export const SYNTHETIC_AERO_SLIPSTREAM_SPEC: ConcentratedSpec = {
  label: L.wethUsdcAeroSlipstream,
  variant: 'aero-slipstream',
  token0: TOKENS.WETH,
  token1: TOKENS.USDC,
  feePips: 465,
  tickSpacing: 50,
  price: ETH,
  createdOffset: 900_000n,
  templates: [
    { lower: -2000, upper: 2000, liquidity: 4n * E18, owner: 3, staked: true },
    { lower: -500, upper: 500, liquidity: 3n * E18, owner: 1, staked: true },
    { lower: -100, upper: 150, liquidity: 2n * E18, owner: 2, staked: true },
    { lower: -1000, upper: 1000, liquidity: E18, owner: 0 },
  ],
  firstTokenId: 9_001n,
  activity: { volumeUsd: 12_000_000, swapCount: 160, token0Usd: ETH, token1Usd: USD },
}

/** `PoolCreated` of an Aero pool on its factory. */
export function aeroCreationLog(meta: PoolMeta, addresses: ChainAddresses): FixtureLog {
  const common = { blockNumber: meta.createdAtBlock, logIndex: 0 }
  if (meta.dex === 'aero-v2')
    return makeLog({
      address: meta.stable ? addresses.aeroV2.stableFactory : addresses.aeroV2.volatileFactory,
      abi: aeroPoolFactoryAbi,
      eventName: 'PoolCreated',
      args: {
        token0: meta.token0.address,
        token1: meta.token1.address,
        pool: meta.address,
        length: 1n,
      },
      ...common,
    })
  const factory = addresses.aeroSlipstream[AERO_SLIPSTREAM_FACTORY_INDEX]?.factory
  if (factory === undefined) throw new Error('synthetic: no Aero Slipstream deployment configured')
  return makeLog({
    address: factory,
    abi: aerodromeCLFactoryAbi,
    eventName: 'PoolCreated',
    args: {
      token0: meta.token0.address,
      token1: meta.token1.address,
      tickSpacing: meta.tickSpacing,
      pool: meta.address,
    },
    ...common,
  })
}

/** An Aero v2 pool's factory reads: `getBaseFee` and the pinned `feeModule()`; `stable()` reverts. */
export function registerAeroV2Fee(
  fixture: Fixture,
  pool: SyntheticV2Pool,
  addresses: ChainAddresses,
  blocks: BlockRef[],
): void {
  const address = pool.meta.address as Address
  const { aeroV2 } = addresses
  const factory = pool.meta.stable ? aeroV2.stableFactory : aeroV2.volatileFactory
  const feeModule = pool.meta.stable ? aeroV2.stableFeeModule : aeroV2.volatileFeeModule
  const abi = aeroPoolFactoryAbi
  registerCall(fixture, {
    to: factory,
    abi,
    functionName: 'getBaseFee',
    args: [address, ZERO_ADDRESS, 0n, 0n, 0n, 0n],
    result: pool.feeBps,
    blocks,
  })
  registerCall(fixture, { to: factory, abi, functionName: 'feeModule', result: feeModule, blocks })
  registerRevert(fixture, { to: address, abi: aerodromePoolAbi, functionName: 'stable', blocks })
}

/** `FactoryRegistry.targetToGauge(pool)`: the Aero v2 pool's gauge. */
export function registerAeroV2Gauge(
  fixture: Fixture,
  pool: SyntheticV2Pool,
  addresses: ChainAddresses,
  blocks: BlockRef[],
): void {
  registerCall(fixture, {
    to: addresses.aeroV2.factoryRegistry,
    abi: aeroFactoryRegistryAbi,
    functionName: 'targetToGauge',
    args: [pool.meta.address as Address],
    result: pool.gauge,
    blocks,
  })
}

/**
 * The Aero Slipstream pool's factory and hook reads: `getPool` and `tickSpacingToFee` on every
 * Aero deployment (only the owning one knows the pool), and at `blocks` `isPool`,
 * `getPoolSwapHook` (the reviewed hook) and the hook's `dynamicFeeConfig`.
 */
export function registerAeroSlipstreamHook(
  fixture: Fixture,
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
  blocks: BlockRef[],
): void {
  const address = pool.meta.address as Address
  const ts = pool.meta.tickSpacing ?? 0
  const c = SYNTHETIC_AERO_HOOK_CONFIG
  addresses.aeroSlipstream.forEach((d, i) => {
    const owns = i === AERO_SLIPSTREAM_FACTORY_INDEX
    const factory = d.factory
    registerCall(fixture, {
      to: factory,
      abi: aerodromeCLFactoryAbi,
      functionName: 'getPool',
      args: [pool.meta.token0.address, pool.meta.token1.address, ts],
      result: owns ? address : ZERO_ADDRESS,
    })
    registerCall(fixture, {
      to: factory,
      abi: aerodromeCLFactoryAbi,
      functionName: 'tickSpacingToFee',
      args: [ts],
      result: 500,
    })
    const hookCall = { to: factory, abi: aeroCLFactoryAbi, args: [address], blocks }
    registerCall(fixture, { ...hookCall, functionName: 'isPool', result: owns })
    registerCall(fixture, { ...hookCall, functionName: 'getPoolSwapHook', result: d.swapHook })
    registerCall(fixture, {
      to: d.swapHook,
      abi: aeroSwapHookAbi,
      functionName: 'dynamicFeeConfig',
      args: [address],
      result: [c.baseFee, c.feeCap, c.scalingFactor, c.initialFeeEnabled, c.initialFee],
      blocks,
    })
  })
}
