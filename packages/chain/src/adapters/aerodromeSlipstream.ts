/**
 * Aerodrome Slipstream (Uniswap v3 fork) on Base. Three live CLFactory deployments coexist, each
 * with its own NonfungiblePositionManager; discovery and positions run over all of them while pool
 * ids stay `aerodrome-slipstream:<pool>`. Pools are keyed by tickSpacing; `fee()` is live (swap fee
 * modules, possibly dynamic) and is read at discovery and again with every state read.
 */
import type { Address, PoolMeta, Position } from '@depthwatch/core'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromeCLGaugeAbi } from '../abi/aerodromeCLGauge.js'
import { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import { slipstreamNFPMAbi } from '../abi/slipstreamNFPM.js'
import type { SlipstreamDeployment } from '../addresses.js'
import { lowercase, type ReaderContext, unique, ZERO_ADDRESS } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs } from '../internal/logs.js'
import { asNumber, expectResult, multicallBatched, optionalResult } from '../internal/multicall.js'
import { readTokens, tokenMap } from '../internal/tokens.js'
import type { BlockRange, DexAdapter } from '../internal/types.js'
import {
  overviewAddressKeyed,
  readConcentratedAddressKeyed,
  readNfpmPositions,
  readV3StyleSwaps,
  requireAddress,
  tokenOrThrow,
} from './shared.js'

export const DEX = 'aerodrome-slipstream' as const

export function slipstreamPoolId(address: string): string {
  return `${DEX}:${lowercase(address)}`
}

/** A Slipstream pool as its `PoolCreated` event, or a seeded `getPool` answer, describes it. */
export interface SlipstreamPoolRecord {
  pool: Address
  token0: Address
  token1: Address
  tickSpacing: number
  /** Creation block. */
  blockNumber: bigint
}

/**
 * PoolMeta of one deployment's pools: token metadata (cached) and the live `fee()` per pool, with
 * the factory's `tickSpacingToFee` default as the fallback.
 */
export async function slipstreamPoolMetas(
  ctx: ReaderContext,
  deployment: SlipstreamDeployment,
  records: readonly SlipstreamPoolRecord[],
): Promise<PoolMeta[]> {
  if (records.length === 0) return []
  const tokens = tokenMap(
    await readTokens(
      ctx,
      records.flatMap((r) => [r.token0, r.token1]),
    ),
  )
  const feeResults = await multicallBatched(
    ctx,
    records.flatMap((r) => [
      { address: lowercase(r.pool), abi: aerodromeCLPoolAbi, functionName: 'fee' },
      {
        address: deployment.factory,
        abi: aerodromeCLFactoryAbi,
        functionName: 'tickSpacingToFee',
        args: [r.tickSpacing],
      },
    ]),
  )
  return records.map((r, i) => {
    const fee = optionalResult(feeResults[i * 2]) ?? optionalResult(feeResults[i * 2 + 1])
    if (fee === undefined) throw new Error(`slipstream: cannot read fee for pool ${r.pool}`)
    return {
      id: slipstreamPoolId(r.pool),
      dex: DEX,
      kind: 'concentrated',
      address: lowercase(r.pool),
      poolId: null,
      token0: tokenOrThrow(tokens, r.token0),
      token1: tokenOrThrow(tokens, r.token1),
      feePips: asNumber(fee, 'fee'),
      tickSpacing: r.tickSpacing,
      stable: false,
      hooks: null,
      createdAtBlock: r.blockNumber,
    }
  })
}

async function discoverDeployment(
  ctx: ReaderContext,
  deployment: SlipstreamDeployment,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolMeta[]> {
  const logs = await fetchLogs(
    ctx,
    { address: deployment.factory, topics: [eventTopics(aerodromeCLFactoryAbi, 'PoolCreated')] },
    fromBlock,
    toBlock,
  )
  return slipstreamPoolMetas(
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
    ctx.addresses.aerodromeSlipstream.map((d) => discoverDeployment(ctx, d, fromBlock, toBlock)),
  )
  return perDeployment.flat().sort((a, b) => (a.createdAtBlock < b.createdAtBlock ? -1 : 1))
}

/** Deployments whose factory reports this (token0, token1, tickSpacing) pool at `pool.address`. */
async function owningDeployments(
  ctx: ReaderContext,
  pool: PoolMeta,
): Promise<SlipstreamDeployment[]> {
  const deployments = ctx.addresses.aerodromeSlipstream
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
          abi: slipstreamNFPMAbi,
          keyValue: pool.tickSpacing ?? 0,
        },
        pool,
        range,
      ),
    ),
  )
  return perNfpm.flat()
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

export const aerodromeSlipstreamAdapter: DexAdapter = {
  dex: DEX,
  discover,
  overview: (ctx, pools, blockNumber) =>
    overviewAddressKeyed(ctx, pools, blockNumber, aerodromeCLPoolAbi),
  state: (ctx, pool, opts) => readConcentratedAddressKeyed(ctx, pool, opts, aerodromeCLPoolAbi),
  positions,
  swaps: readV3StyleSwaps,
  stakedOwners: resolveStakedOwners,
  custodians: slipstreamCustodians,
}
