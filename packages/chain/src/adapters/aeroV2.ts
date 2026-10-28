/**
 * Aero v2 AMM pools (`aero-v2`): one PoolFactory per pool type (`ChainAddresses.aeroV2`), volatile
 * pools x·y = k and stable pools x³y + xy³ = k, so the factory that created a pool gives its kind.
 * Their `PoolCreated` carries no `stable` flag (one log filter covers both factories), and the
 * pools answer `getReserves` and emit `Swap` as Aerodrome v2 pools do (./aerodromeV2.ts: one
 * shared swap scan). `metadata()` (6 outputs) and `stable()` (reverts) are never read.
 *
 * Fee: `PoolFactory.getBaseFee(pool, 0x0, 0, 0, 0, 0)` in basis points (×100 for pips), which asks
 * the factory's `feeModule()`. The reviewed CustomFeeModule reads only the pool's override (or
 * lets the factory return its default), so the zeroed caller and amounts do not matter; every read
 * that produces a fee sends the factory's `feeModule()` in the same multicall and throws
 * `PoolConfigChangedError` when it is not the pinned `volatileFeeModule` / `stableFeeModule`. The
 * MEV tax and caller discounts are not modelled (docs/METRICS.md, "Swap fee").
 *
 * LP holdings: the pool is the LP token; its gauge is `FactoryRegistry.targetToGauge(pool)` (the
 * LeafVoter has no pool views) and the gauge's `balanceOf(owner)` is the staked balance.
 */
import type { Address, PoolMeta, PoolState } from '@depthwatch/core'
import { aerodromePoolAbi } from '../abi/aerodromePool.js'
import { aeroFactoryRegistryAbi } from '../abi/aeroFactoryRegistry.js'
import { aeroPoolFactoryAbi } from '../abi/aeroPoolFactory.js'
import { lowercase, type ReaderContext, unique, ZERO_ADDRESS } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs } from '../internal/logs.js'
import {
  asBigint,
  type CallResult,
  type ContractCall,
  expectResult,
  multicallBatched,
} from '../internal/multicall.js'
import { PoolConfigChangedError } from '../internal/poolErrors.js'
import { readTokens, tokenMap } from '../internal/tokens.js'
import type { DexAdapter, StateOptions } from '../internal/types.js'
import {
  bpsToPips,
  overviewReserves,
  readLpHoldingsVia,
  readV2StyleSwaps,
  reserveState,
} from './aerodromeV2.js'
import { requireAddress, type StateGuard, tokenOrThrow } from './shared.js'

export const DEX = 'aero-v2' as const

export function aeroV2PoolId(address: string): string {
  return `${DEX}:${lowercase(address)}`
}

/** An Aero v2 pool as its `PoolCreated` event, or a seeded `getPool` answer, describes it. */
export interface AeroV2PoolRecord {
  pool: Address
  token0: Address
  token1: Address
  /** The factory that created it: the volatile or the stable one. */
  factory: Address
  /** Creation block. */
  blockNumber: bigint
}

interface AeroV2Factory {
  address: Address
  stable: boolean
  /** The CustomFeeModule its `feeModule()` must return. */
  feeModule: Address
}

/** The configured factory at `address` (lowercase); throws for any other address. */
function factoryAt(ctx: ReaderContext, address: Address): AeroV2Factory {
  const { volatileFactory, stableFactory, volatileFeeModule, stableFeeModule } =
    ctx.addresses.aeroV2
  const factory = lowercase(address)
  if (factory === volatileFactory)
    return { address: factory, stable: false, feeModule: volatileFeeModule }
  if (factory === stableFactory)
    return { address: factory, stable: true, feeModule: stableFeeModule }
  throw new Error(`${DEX}: ${address} is not a configured Aero v2 pool factory`)
}

/** The factory of a pool: stable pools come from the stable factory, the others from the volatile. */
function factoryOf(ctx: ReaderContext, pool: Pick<PoolMeta, 'stable'>): AeroV2Factory {
  const { volatileFactory, stableFactory } = ctx.addresses.aeroV2
  return factoryAt(ctx, pool.stable ? stableFactory : volatileFactory)
}

const feeModuleCall = (factory: AeroV2Factory): ContractCall => ({
  address: factory.address,
  abi: aeroPoolFactoryAbi,
  functionName: 'feeModule',
})

const baseFeeCall = (factory: AeroV2Factory, pool: Address): ContractCall => ({
  address: factory.address,
  abi: aeroPoolFactoryAbi,
  functionName: 'getBaseFee',
  args: [pool, ZERO_ADDRESS, 0n, 0n, 0n, 0n],
})

/** Throws `PoolConfigChangedError` unless `result` is the factory's pinned fee module. */
function checkFeeModule(subject: string, factory: AeroV2Factory, result: CallResult | undefined) {
  const feeModule = lowercase(String(expectResult(result, `${factory.address} feeModule`)))
  if (feeModule !== factory.feeModule)
    throw new PoolConfigChangedError(subject, 'fee module changed', feeModule)
}

/** Factory label in errors: `aero-v2 volatile factory 0x…`. */
const factoryName = (factory: AeroV2Factory) =>
  `${DEX} ${factory.stable ? 'stable' : 'volatile'} factory ${factory.address}`

/**
 * `feeModule()` of both factories and its check, for a read that sends other calls (seeding):
 * `check` throws `PoolConfigChangedError` for a factory off its pinned module.
 */
export function aeroV2FeeModuleGuard(ctx: ReaderContext): StateGuard {
  const { volatileFactory, stableFactory } = ctx.addresses.aeroV2
  const factories = [factoryAt(ctx, volatileFactory), factoryAt(ctx, stableFactory)]
  return {
    calls: factories.map(feeModuleCall),
    check(results) {
      factories.forEach((f, i) => {
        checkFeeModule(factoryName(f), f, results[i])
      })
    },
  }
}

const feePipsOf = (result: CallResult | undefined, what: string): number =>
  bpsToPips(asBigint(expectResult(result, what), 'fee'))

/**
 * PoolMeta of Aero v2 pools: token metadata (cached), `getBaseFee` per pool and `feeModule()` once
 * per factory involved, in one multicall; a factory off its pinned module fails the whole read.
 */
export async function aeroV2PoolMetas(
  ctx: ReaderContext,
  records: readonly AeroV2PoolRecord[],
): Promise<PoolMeta[]> {
  if (records.length === 0) return []
  const tokens = tokenMap(
    await readTokens(
      ctx,
      records.flatMap((r) => [r.token0, r.token1]),
    ),
  )
  const factories = unique(records.map((r) => lowercase(r.factory))).map((f) => factoryAt(ctx, f))
  const results = await multicallBatched(ctx, [
    ...factories.map(feeModuleCall),
    ...records.map((r) => baseFeeCall(factoryAt(ctx, r.factory), lowercase(r.pool))),
  ])
  factories.forEach((factory, i) => {
    checkFeeModule(factoryName(factory), factory, results[i])
  })
  return records.map((r, i) => {
    const { stable } = factoryAt(ctx, r.factory)
    const address = lowercase(r.pool)
    return {
      id: aeroV2PoolId(address),
      dex: DEX,
      kind: stable ? 'stable-swap' : 'constant-product',
      address,
      poolId: null,
      token0: tokenOrThrow(tokens, r.token0),
      token1: tokenOrThrow(tokens, r.token1),
      feePips: feePipsOf(results[factories.length + i], `${DEX} getBaseFee(${address})`),
      tickSpacing: null,
      stable,
      hooks: null,
      createdAtBlock: r.blockNumber,
    }
  })
}

/** Both factories' `PoolCreated` in one filter (one `eth_getLogs` per chunk). */
async function discover(
  ctx: ReaderContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolMeta[]> {
  const { volatileFactory, stableFactory } = ctx.addresses.aeroV2
  const logs = await fetchLogs(
    ctx,
    {
      address: [volatileFactory, stableFactory],
      topics: [eventTopics(aeroPoolFactoryAbi, 'PoolCreated')],
    },
    fromBlock,
    toBlock,
  )
  return aeroV2PoolMetas(
    ctx,
    decodeLogs(aeroPoolFactoryAbi, 'PoolCreated', logs).map(({ args, address, blockNumber }) => ({
      pool: args.pool,
      token0: args.token0,
      token1: args.token1,
      factory: address,
      blockNumber,
    })),
  )
}

/** Reserves, `getBaseFee` and the factory's `feeModule()` at the block, in one multicall. */
async function state(ctx: ReaderContext, pool: PoolMeta, opts: StateOptions): Promise<PoolState> {
  const address = requireAddress(pool)
  const factory = factoryOf(ctx, pool)
  const results = await multicallBatched(
    ctx,
    [
      { address, abi: aerodromePoolAbi, functionName: 'getReserves' },
      baseFeeCall(factory, address),
      feeModuleCall(factory),
    ],
    opts.blockNumber,
  )
  checkFeeModule(pool.id, factory, results[2])
  const reserves = expectResult(results[0], `${pool.id} getReserves`)
  return reserveState(pool, opts, reserves, feePipsOf(results[1], `${pool.id} getBaseFee`))
}

export const aeroV2Adapter: DexAdapter = {
  dex: DEX,
  discover,
  overview: overviewReserves,
  state,
  positions: async () => [],
  swaps: readV2StyleSwaps,
  lpHoldings: (ctx, pool, addresses, blockNumber) =>
    readLpHoldingsVia(ctx, pool, addresses, blockNumber, {
      call: {
        address: ctx.addresses.aeroV2.factoryRegistry,
        abi: aeroFactoryRegistryAbi,
        functionName: 'targetToGauge',
        args: [requireAddress(pool)],
      },
      what: 'FactoryRegistry.targetToGauge',
    }),
}
