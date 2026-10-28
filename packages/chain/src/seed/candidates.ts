/**
 * Seeded discovery per DEX: pools of a token list found without logs, by asking each DEX directly
 * at one block, every read through Multicall3.
 *
 * - Uniswap v3: `feeAmountTickSpacing(fee)` for the candidate tiers (a tier answered with 0 is not
 *   enabled), then `getPool(token0, token1, fee)` for every pair and enabled tier.
 * - Aerodrome v2: `PoolFactory.getPool(token0, token1, stable)`, stable and volatile.
 * - Aero v2 (./aero.ts): `getPool(token0, token1)` on the volatile and on the stable factory.
 * - Slipstream (Aerodrome and Aero): per CLFactory, `tickSpacings()` (every spacing it enables),
 *   then `getPool(token0, token1, tickSpacing)`.
 * - Uniswap v4: StateView `getSlot0` of the PoolKey id for (currency0, currency1, fee, tickSpacing,
 *   hooks = address(0)) over the standard tiers, currencies sorted, native ETH as address(0); a
 *   pool counts when its sqrtPriceX96 ≠ 0 (initialized).
 *
 * A non-zero answer becomes a record the adapter builds PoolMeta from, exactly as for its creation
 * log, once the creation block is known (./createdAt.ts).
 */
import { type Address, type Dex, NATIVE_ETH, type PoolMeta } from '@depthwatch/core'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromePoolFactoryAbi } from '../abi/aerodromePoolFactory.js'
import { uniswapV3FactoryAbi } from '../abi/uniswapV3Factory.js'
import { v4StateViewAbi } from '../abi/v4StateView.js'
import { aerodromeSlipstreamFamily } from '../adapters/aerodromeSlipstream.js'
import { aerodromeV2PoolId, aerodromeV2PoolMetas } from '../adapters/aerodromeV2.js'
import type { SlipstreamFamily } from '../adapters/slipstreamFamily.js'
import { uniswapV3PoolId, uniswapV3PoolMetas } from '../adapters/uniswapV3.js'
import { computePoolId, uniswapV4PoolId, uniswapV4PoolMetas } from '../adapters/uniswapV4Pools.js'
import type { SlipstreamDeployment } from '../addresses.js'
import { lowercase, type ReaderContext, ZERO_ADDRESS } from '../internal/context.js'
import {
  asBigint,
  asNumber,
  asTuple,
  type CallResult,
  expectResult,
  multicallBatched,
  optionalResult,
} from '../internal/multicall.js'
import { type CreationTarget, slot0SqrtPrice, v4Slot0Call } from './createdAt.js'

/**
 * Uniswap v3 fee tiers asked with `feeAmountTickSpacing` (docs/research/base-contracts.md: the
 * constructor's 500 / 3000 / 10000, and 100, 200, 300, 400 read as enabled on Base).
 */
export const UNISWAP_V3_CANDIDATE_FEES: readonly number[] = Object.freeze([
  100, 200, 300, 400, 500, 3_000, 10_000,
])

/** Uniswap v4 (fee, tickSpacing) tiers seeded without hooks. */
export const UNISWAP_V4_STANDARD_KEYS: readonly { fee: number; tickSpacing: number }[] =
  Object.freeze([
    { fee: 100, tickSpacing: 1 },
    { fee: 500, tickSpacing: 10 },
    { fee: 3_000, tickSpacing: 60 },
    { fee: 10_000, tickSpacing: 200 },
  ])

/** What one DEX's seeding found, and how to turn it into PoolMeta once creation blocks are known. */
export interface DexSeed {
  dex: Dex
  /** Keys asked for: pairs × fee tiers, stable flags, tick spacings or PoolKeys. */
  candidates: number
  targets: CreationTarget[]
  /** PoolMeta of the found pools whose creation block `createdAt` has; the others are skipped. */
  build(createdAt: ReadonlyMap<string, bigint>): Promise<PoolMeta[]>
}

export type DexSeeder = (
  ctx: ReaderContext,
  blockNumber: bigint,
  tokens: readonly Address[],
) => Promise<DexSeed>

/** Every pair of distinct addresses, ordered as the factories order them (token0 < token1). */
export function sortedPairs(addresses: readonly Address[]): Array<readonly [Address, Address]> {
  const list = [...new Set(addresses.map(lowercase))].sort()
  const out: Array<readonly [Address, Address]> = []
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) out.push([a, b])
  })
  return out
}

/** The tokens other than native ETH, which only Uniswap v4 pairs. */
export const erc20s = (tokens: readonly Address[]) =>
  tokens.filter((t) => lowercase(t) !== NATIVE_ETH)

/** A factory's `getPool` answer: the pool, or undefined for address(0); a failed call throws. */
export function poolAddress(result: CallResult | undefined, what: string): Address | undefined {
  const value = lowercase(String(expectResult(result, what)))
  return value === ZERO_ADDRESS ? undefined : value
}

/** The records whose creation block `createdAt` has, with it as `blockNumber`. */
export function dated<R>(
  records: readonly R[],
  idOf: (record: R) => string,
  createdAt: ReadonlyMap<string, bigint>,
): Array<R & { blockNumber: bigint }> {
  return records.flatMap((r) => {
    const blockNumber = createdAt.get(idOf(r))
    return blockNumber === undefined ? [] : [{ ...r, blockNumber }]
  })
}

/** A contract pool dated by `eth_getCode`, searched from its factory's start block. */
export const codeTarget = (id: string, address: Address, lowerBound: bigint): CreationTarget => ({
  id,
  probe: { kind: 'code', address },
  lowerBound,
})

export const seedUniswapV3: DexSeeder = async (ctx, block, tokens) => {
  const { factory, startBlock } = ctx.addresses.uniswapV3
  const abi = uniswapV3FactoryAbi
  const spacings = await multicallBatched(
    ctx,
    UNISWAP_V3_CANDIDATE_FEES.map((fee) => ({
      address: factory,
      abi,
      functionName: 'feeAmountTickSpacing',
      args: [fee],
    })),
    block,
  )
  const tiers = UNISWAP_V3_CANDIDATE_FEES.flatMap((fee, i) => {
    const what = `uniswap-v3 feeAmountTickSpacing(${fee})`
    const tickSpacing = asNumber(expectResult(spacings[i], what), 'tickSpacing')
    return tickSpacing > 0 ? [{ fee, tickSpacing }] : []
  })
  const keys = sortedPairs(erc20s(tokens)).flatMap(([token0, token1]) =>
    tiers.map((tier) => ({ token0, token1, ...tier })),
  )
  const results = await multicallBatched(
    ctx,
    keys.map((k) => ({
      address: factory,
      abi,
      functionName: 'getPool',
      args: [k.token0, k.token1, k.fee],
    })),
    block,
  )
  const records = keys.flatMap((k, i) => {
    const pool = poolAddress(results[i], `uniswap-v3 getPool(${k.token0}, ${k.token1}, ${k.fee})`)
    return pool === undefined ? [] : [{ ...k, pool }]
  })
  return {
    dex: 'uniswap-v3',
    candidates: keys.length,
    targets: records.map((r) => codeTarget(uniswapV3PoolId(r.pool), r.pool, startBlock)),
    build: (createdAt) =>
      uniswapV3PoolMetas(
        ctx,
        dated(records, (r) => uniswapV3PoolId(r.pool), createdAt),
      ),
  }
}

export const seedAerodromeV2: DexSeeder = async (ctx, block, tokens) => {
  const { poolFactory, startBlock } = ctx.addresses.aerodromeV2
  const keys = sortedPairs(erc20s(tokens)).flatMap(([token0, token1]) =>
    [false, true].map((stable) => ({ token0, token1, stable })),
  )
  const results = await multicallBatched(
    ctx,
    keys.map((k) => ({
      address: poolFactory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getPool',
      args: [k.token0, k.token1, k.stable],
    })),
    block,
  )
  const records = keys.flatMap((k, i) => {
    const what = `aerodrome-v2 getPool(${k.token0}, ${k.token1}, ${k.stable})`
    const pool = poolAddress(results[i], what)
    return pool === undefined ? [] : [{ ...k, pool }]
  })
  return {
    dex: 'aerodrome-v2',
    candidates: keys.length,
    targets: records.map((r) => codeTarget(aerodromeV2PoolId(r.pool), r.pool, startBlock)),
    build: (createdAt) =>
      aerodromeV2PoolMetas(
        ctx,
        dated(records, (r) => aerodromeV2PoolId(r.pool), createdAt),
      ),
  }
}

/** The seeder of a Slipstream family: every deployment's enabled spacings, then `getPool`. */
export function slipstreamSeeder<D extends SlipstreamDeployment>(
  family: SlipstreamFamily<D>,
): DexSeeder {
  return async (ctx, block, tokens) => {
    const deployments = family.deployments(ctx)
    const abi = aerodromeCLFactoryAbi
    const enabled = await multicallBatched(
      ctx,
      deployments.map((d) => ({ address: d.factory, abi, functionName: 'tickSpacings' })),
      block,
    )
    const pairs = sortedPairs(erc20s(tokens))
    const keys = deployments.flatMap((deployment, i) => {
      const what = `${family.dex} ${deployment.name} tickSpacings()`
      const spacings = asTuple(expectResult(enabled[i], what), what).map((s) => asNumber(s, what))
      return pairs.flatMap(([token0, token1]) =>
        spacings.map((tickSpacing) => ({ deployment, token0, token1, tickSpacing })),
      )
    })
    const results = await multicallBatched(
      ctx,
      keys.map((k) => ({
        address: k.deployment.factory,
        abi,
        functionName: 'getPool',
        args: [k.token0, k.token1, k.tickSpacing],
      })),
      block,
    )
    const records = keys.flatMap((k, i) => {
      const what = `${family.dex} ${k.deployment.name} getPool(${k.token0}, ${k.token1}, ${k.tickSpacing})`
      const pool = poolAddress(results[i], what)
      return pool === undefined ? [] : [{ ...k, pool }]
    })
    return {
      dex: family.dex,
      candidates: keys.length,
      targets: records.map((r) =>
        codeTarget(family.poolId(r.pool), r.pool, r.deployment.startBlock),
      ),
      async build(createdAt) {
        const perDeployment = await Promise.all(
          deployments.map((deployment) =>
            family.poolMetas(
              ctx,
              deployment,
              dated(
                records.filter((r) => r.deployment === deployment),
                (r) => family.poolId(r.pool),
                createdAt,
              ),
            ),
          ),
        )
        return perDeployment.flat()
      },
    }
  }
}

/** Aerodrome Slipstream: the Slipstream seeder over `aerodromeSlipstream`'s deployments. */
export const seedSlipstream: DexSeeder = slipstreamSeeder(aerodromeSlipstreamFamily)

export const seedUniswapV4: DexSeeder = async (ctx, block, tokens) => {
  const { stateView, startBlock } = ctx.addresses.uniswapV4
  const keys = sortedPairs(tokens).flatMap(([currency0, currency1]) =>
    UNISWAP_V4_STANDARD_KEYS.map(({ fee, tickSpacing }) => {
      const key = { currency0, currency1, fee, tickSpacing, hooks: ZERO_ADDRESS }
      return { ...key, id: computePoolId(key) }
    }),
  )
  const slot0s = await multicallBatched(
    ctx,
    keys.map((k) => ({
      address: stateView,
      abi: v4StateViewAbi,
      functionName: 'getSlot0',
      args: [k.id],
    })),
    block,
  )
  const records = keys.flatMap((k, i) => {
    const slot0 = asTuple(expectResult(slot0s[i], `uniswap-v4 getSlot0(${k.id})`), 'getSlot0')
    const sqrtPriceX96 = asBigint(slot0[0], 'sqrtPriceX96')
    return sqrtPriceX96 === 0n ? [] : [{ ...k, sqrtPriceX96 }]
  })
  // The creation search reads the PoolManager word StateView decodes: both must agree here.
  const words = await multicallBatched(
    ctx,
    records.map((r) => v4Slot0Call(ctx, r.id)),
    block,
  )
  records.forEach((r, i) => {
    const word = slot0SqrtPrice(optionalResult(words[i]))
    if (word !== r.sqrtPriceX96)
      throw new Error(
        `seed: PoolManager slot0 of ${r.id} reads sqrtPriceX96 ${word} at block ${block}, ` +
          `StateView ${r.sqrtPriceX96}`,
      )
  })
  return {
    dex: 'uniswap-v4',
    candidates: keys.length,
    targets: records.map((r) => ({
      id: uniswapV4PoolId(r.id),
      probe: { kind: 'v4', poolId: r.id },
      lowerBound: startBlock,
    })),
    build: (createdAt) =>
      uniswapV4PoolMetas(
        ctx,
        dated(records, (r) => uniswapV4PoolId(r.id), createdAt),
      ),
  }
}
