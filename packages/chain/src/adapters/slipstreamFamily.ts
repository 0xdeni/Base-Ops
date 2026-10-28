/**
 * The Slipstream family: Aerodrome Slipstream (three CLFactory deployments) and Aero Slipstream
 * (one), Uniswap v3 forks that share the CLFactory's `PoolCreated`, `getPool`, `tickSpacings` and
 * `tickSpacingToFee`, the CLPool's `slot0`, `ticks`, `fee` and `gauge`, the NFPM's `positions()`
 * and the CLGauge's `stakedContains` (signatures pinned by abi/aero.test.ts). One family is built
 * per DEX from its deployments, its NFPM ABI and optional pool checks (Aero: the swap hook);
 * discovery and positions run over every deployment while pool ids stay `<dex>:<pool>`.
 *
 * Pools are keyed by tickSpacing. `fee()` is live (Aerodrome: a swap fee module; Aero: the swap
 * hook, which sets it per block) and is read at discovery and again with every state read, with
 * the factory's `tickSpacingToFee` default as the fallback when it reverts.
 */
import type { Address, PoolMeta, Position } from '@depthwatch/core'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromeCLGaugeAbi } from '../abi/aerodromeCLGauge.js'
import { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import type { aeroNFPMAbi } from '../abi/aeroNFPM.js'
import type { slipstreamNFPMAbi } from '../abi/slipstreamNFPM.js'
import type { SlipstreamDeployment } from '../addresses.js'
import { lowercase, type ReaderContext, unique, ZERO_ADDRESS } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs } from '../internal/logs.js'
import {
  asNumber,
  type CallResult,
  type ContractCall,
  expectResult,
  multicallBatched,
  optionalResult,
} from '../internal/multicall.js'
import { readTokens, tokenMap } from '../internal/tokens.js'
import type { BlockRange, DexAdapter } from '../internal/types.js'
import {
  overviewAddressKeyed,
  readConcentratedAddressKeyed,
  readNfpmPositions,
  readV3StyleSwaps,
  requireAddress,
  type StateGuard,
  tokenOrThrow,
} from './shared.js'

export type SlipstreamDex = 'aerodrome-slipstream' | 'aero-slipstream'

/** A Slipstream pool as its `PoolCreated` event, or a seeded `getPool` answer, describes it. */
export interface SlipstreamPoolRecord {
  pool: Address
  token0: Address
  token1: Address
  tickSpacing: number
  /** Creation block. */
  blockNumber: bigint
}

/** What a DEX adds to the family's reads (Aero Slipstream: its swap hook). */
export interface SlipstreamPoolChecks<D extends SlipstreamDeployment> {
  /** Calls read with each pool's `fee()` at discovery and seeding (same multicall). */
  metaCalls(deployment: D, pool: Address): ContractCall[]
  /** The pool's `PoolMeta.hooks` from the results of its `metaCalls`, in order. */
  hooks(deployment: D, pool: Address, results: readonly CallResult[]): Address | null
  /** Calls and check every state read of `pool` carries (shared.ts `StateGuard`). */
  stateGuard(deployments: readonly D[], pool: PoolMeta): StateGuard
}

export interface SlipstreamFamilySpec<D extends SlipstreamDeployment> {
  dex: SlipstreamDex
  deployments(ctx: ReaderContext): readonly D[]
  /** The NFPM's ABI: its `IncreaseLiquidity` topic is what the positions scan asks for. */
  nfpmAbi: typeof slipstreamNFPMAbi | typeof aeroNFPMAbi
  checks?: SlipstreamPoolChecks<D>
}

export interface SlipstreamFamily<D extends SlipstreamDeployment> {
  readonly dex: SlipstreamDex
  deployments(ctx: ReaderContext): readonly D[]
  poolId(address: string): string
  /**
   * PoolMeta of one deployment's pools: token metadata (cached), the live `fee()` per pool (the
   * factory's `tickSpacingToFee` as the fallback) and, with checks, `hooks`; one multicall.
   */
  poolMetas(
    ctx: ReaderContext,
    deployment: D,
    records: readonly SlipstreamPoolRecord[],
  ): Promise<PoolMeta[]>
  readonly adapter: DexAdapter
}

/** The pool's CLGauge (`CLPool.gauge()`, lowercase); null when it has none (address zero). */
async function poolGauge(
  ctx: ReaderContext,
  pool: PoolMeta,
  blockNumber?: bigint,
): Promise<Address | null> {
  const [result] = await multicallBatched(
    ctx,
    [{ address: requireAddress(pool), abi: aerodromeCLPoolAbi, functionName: 'gauge' }],
    blockNumber,
  )
  const gauge = lowercase(String(expectResult(result, `${pool.id} gauge`)))
  return gauge === ZERO_ADDRESS ? null : gauge
}

/** The pool's custodians: its CLGauge, which owns every staked NFT ([] without a gauge). */
export async function slipstreamCustodians(
  ctx: ReaderContext,
  pool: PoolMeta,
  blockNumber?: bigint,
): Promise<Address[]> {
  const gauge = await poolGauge(ctx, pool, blockNumber)
  return gauge === null ? [] : [gauge]
}

/**
 * Staked positions belong to the pool's CLGauge (`CLPool.gauge()`), which the NFPM reports as
 * `ownerOf`. For every position owned by the gauge (with a tokenId), `CLGauge.stakedContains(
 * candidate, tokenId)` is asked for each candidate in one multicall and `owner` is rewritten to the
 * first matching candidate (lowercased); further matches, which the gauge cannot produce for a
 * single NFT anyway, are ignored. Positions that are not gauge-owned, have no tokenId or match no
 * candidate are returned as the same objects. No gauge or no candidates → nothing is read.
 */
export async function resolveStakedOwners(
  ctx: ReaderContext,
  pool: PoolMeta,
  positions: readonly Position[],
  candidates: readonly Address[],
  blockNumber?: bigint,
): Promise<Position[]> {
  const depositors = unique(candidates.map(lowercase))
  if (positions.length === 0 || depositors.length === 0) return [...positions]
  const gauge = await poolGauge(ctx, pool, blockNumber)
  if (gauge === null) return [...positions]
  const staked = positions.filter((p) => p.tokenId !== null && lowercase(p.owner) === gauge)
  if (staked.length === 0) return [...positions]
  const results = await multicallBatched(
    ctx,
    staked.flatMap((p) =>
      depositors.map((depositor) => ({
        address: gauge,
        abi: aerodromeCLGaugeAbi,
        functionName: 'stakedContains' as const,
        args: [depositor, p.tokenId as bigint],
      })),
    ),
    blockNumber,
  )
  const resolved = new Map<Position, Address>()
  staked.forEach((p, i) => {
    const match = depositors.findIndex(
      (_, j) => optionalResult(results[i * depositors.length + j]) === true,
    )
    const depositor = depositors[match]
    if (depositor !== undefined) resolved.set(p, depositor)
  })
  return positions.map((p) => {
    const owner = resolved.get(p)
    return owner === undefined ? p : { ...p, owner }
  })
}

export function slipstreamFamily<D extends SlipstreamDeployment>(
  spec: SlipstreamFamilySpec<D>,
): SlipstreamFamily<D> {
  const { dex, checks } = spec
  const poolId = (address: string) => `${dex}:${lowercase(address)}`

  async function poolMetas(
    ctx: ReaderContext,
    deployment: D,
    records: readonly SlipstreamPoolRecord[],
  ): Promise<PoolMeta[]> {
    if (records.length === 0) return []
    const tokens = tokenMap(
      await readTokens(
        ctx,
        records.flatMap((r) => [r.token0, r.token1]),
      ),
    )
    const perPool = records.map((r): ContractCall[] => [
      { address: lowercase(r.pool), abi: aerodromeCLPoolAbi, functionName: 'fee' },
      {
        address: deployment.factory,
        abi: aerodromeCLFactoryAbi,
        functionName: 'tickSpacingToFee',
        args: [r.tickSpacing],
      },
      ...(checks?.metaCalls(deployment, lowercase(r.pool)) ?? []),
    ])
    const results = await multicallBatched(ctx, perPool.flat())
    let offset = 0
    return records.map((r, i) => {
      const own = results.slice(offset, offset + (perPool[i]?.length ?? 0))
      offset += own.length
      const address = lowercase(r.pool)
      const fee = optionalResult(own[0]) ?? optionalResult(own[1])
      if (fee === undefined) throw new Error(`${dex}: cannot read fee for pool ${r.pool}`)
      return {
        id: poolId(address),
        dex,
        kind: 'concentrated',
        address,
        poolId: null,
        token0: tokenOrThrow(tokens, r.token0),
        token1: tokenOrThrow(tokens, r.token1),
        feePips: asNumber(fee, 'fee'),
        tickSpacing: r.tickSpacing,
        stable: false,
        hooks: checks?.hooks(deployment, address, own.slice(2)) ?? null,
        createdAtBlock: r.blockNumber,
      }
    })
  }

  async function discoverDeployment(
    ctx: ReaderContext,
    deployment: D,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<PoolMeta[]> {
    const logs = await fetchLogs(
      ctx,
      { address: deployment.factory, topics: [eventTopics(aerodromeCLFactoryAbi, 'PoolCreated')] },
      fromBlock,
      toBlock,
    )
    return poolMetas(
      ctx,
      deployment,
      decodeLogs(aerodromeCLFactoryAbi, 'PoolCreated', logs).map(({ args, blockNumber }) => ({
        pool: args.pool,
        token0: args.token0,
        token1: args.token1,
        tickSpacing: args.tickSpacing,
        blockNumber,
      })),
    )
  }

  async function discover(
    ctx: ReaderContext,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<PoolMeta[]> {
    const perDeployment = await Promise.all(
      spec.deployments(ctx).map((d) => discoverDeployment(ctx, d, fromBlock, toBlock)),
    )
    return perDeployment.flat().sort((a, b) => (a.createdAtBlock < b.createdAtBlock ? -1 : 1))
  }

  /** Deployments whose factory reports this (token0, token1, tickSpacing) pool at `pool.address`. */
  async function owningDeployments(ctx: ReaderContext, pool: PoolMeta): Promise<D[]> {
    const deployments = spec.deployments(ctx)
    const results = await multicallBatched(
      ctx,
      deployments.map((d) => ({
        address: d.factory,
        abi: aerodromeCLFactoryAbi,
        functionName: 'getPool',
        args: [pool.token0.address, pool.token1.address, pool.tickSpacing ?? 0],
      })),
    )
    return deployments.filter((_, i) => {
      const found = optionalResult(results[i])
      return typeof found === 'string' && lowercase(found) === pool.address
    })
  }

  async function positions(
    ctx: ReaderContext,
    pool: PoolMeta,
    range: BlockRange,
  ): Promise<Position[]> {
    if (pool.tickSpacing === null) return []
    const owners = await owningDeployments(ctx, pool)
    const perNfpm = await Promise.all(
      owners.map((d) =>
        readNfpmPositions(
          ctx,
          {
            positionManager: d.positionManager,
            abi: spec.nfpmAbi,
            keyValue: pool.tickSpacing ?? 0,
          },
          pool,
          range,
        ),
      ),
    )
    return perNfpm.flat()
  }

  return {
    dex,
    deployments: spec.deployments,
    poolId,
    poolMetas,
    adapter: {
      dex,
      discover,
      overview: (ctx, pools, blockNumber) =>
        overviewAddressKeyed(ctx, pools, blockNumber, aerodromeCLPoolAbi),
      state: (ctx, pool, opts) =>
        readConcentratedAddressKeyed(
          ctx,
          pool,
          opts,
          aerodromeCLPoolAbi,
          checks?.stateGuard(spec.deployments(ctx), pool),
        ),
      positions,
      swaps: readV3StyleSwaps,
      stakedOwners: resolveStakedOwners,
      custodians: slipstreamCustodians,
    },
  }
}
