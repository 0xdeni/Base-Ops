/**
 * Helpers shared by the address-keyed concentrated adapters (Uniswap v3, Slipstream): overview via
 * slot0/liquidity/balanceOf, state via the tick-bitmap walk, positions via an NFPM, and v3-style
 * `Swap` decoding (amounts already signed with positive = into the pool).
 */
import type {
  Address,
  ConcentratedState,
  PoolMeta,
  Position,
  SwapEvent,
  TokenInfo,
} from '@depthwatch/core'
import { hexToBigInt } from 'viem'
import type { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import { erc20Abi } from '../abi/erc20.js'
import type { nonfungiblePositionManagerAbi } from '../abi/nonfungiblePositionManager.js'
import type { slipstreamNFPMAbi } from '../abi/slipstreamNFPM.js'
import { uniswapV3PoolAbi } from '../abi/uniswapV3Pool.js'
import { lowercase, type ReaderContext } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs, type LogScanObserver } from '../internal/logs.js'
import {
  asBigint,
  asNumber,
  asTuple,
  expectResult,
  multicallBatched,
  optionalResult,
} from '../internal/multicall.js'
import { rangeSnapshot } from '../internal/snapshot.js'
import { decodeGrossNet, readTicks } from '../internal/ticks.js'
import type {
  BlockRange,
  NfpmPositionsTuple,
  NfpmTokenRecord,
  PoolOverview,
  StateOptions,
} from '../internal/types.js'

export type ConcentratedPoolAbi = typeof uniswapV3PoolAbi | typeof aerodromeCLPoolAbi

export function requireAddress(pool: PoolMeta): Address {
  if (!pool.address) throw new Error(`pool ${pool.id} has no contract address`)
  return pool.address
}

export function tokenOrThrow(map: Map<Address, TokenInfo>, address: Address): TokenInfo {
  const info = map.get(lowercase(address))
  if (!info) throw new Error(`token metadata missing for ${address}`)
  return info
}

export async function overviewAddressKeyed(
  ctx: ReaderContext,
  pools: PoolMeta[],
  blockNumber: bigint,
  abi: ConcentratedPoolAbi,
): Promise<PoolOverview[]> {
  const calls = pools.flatMap((pool) => {
    const address = requireAddress(pool)
    return [
      { address, abi, functionName: 'slot0' },
      { address, abi, functionName: 'liquidity' },
      { address: pool.token0.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
      { address: pool.token1.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
    ]
  })
  const results = await multicallBatched(ctx, calls, blockNumber)
  return pools.map((pool, i) => {
    const slot0 = asTuple(expectResult(results[i * 4], `${pool.id} slot0`), 'slot0')
    return {
      pool,
      blockNumber,
      sqrtPriceX96: asBigint(slot0[0], 'sqrtPriceX96'),
      tick: asNumber(slot0[1], 'tick'),
      liquidity: asBigint(expectResult(results[i * 4 + 1], `${pool.id} liquidity`), 'liquidity'),
      reserve0: asBigint(optionalResult(results[i * 4 + 2]) ?? 0n, 'reserve0'),
      reserve1: asBigint(optionalResult(results[i * 4 + 3]) ?? 0n, 'reserve1'),
    }
  })
}

export async function readConcentratedAddressKeyed(
  ctx: ReaderContext,
  pool: PoolMeta,
  opts: StateOptions,
  abi: ConcentratedPoolAbi,
): Promise<ConcentratedState> {
  const address = requireAddress(pool)
  const base = await multicallBatched(
    ctx,
    (['slot0', 'liquidity', 'fee', 'tickSpacing'] as const).map((functionName) => ({
      address,
      abi,
      functionName,
    })),
    opts.blockNumber,
  )
  const slot0 = asTuple(expectResult(base[0], `${pool.id} slot0`), 'slot0')
  const tick = asNumber(slot0[1], 'tick')
  const tickSpacing = asNumber(expectResult(base[3], `${pool.id} tickSpacing`), 'tickSpacing')
  const walk = await readTicks(
    ctx,
    {
      bitmapCall: (word) => ({ address, abi, functionName: 'tickBitmap', args: [word] }),
      tickCall: (t) => ({ address, abi, functionName: 'ticks', args: [t] }),
      decodeTick: decodeGrossNet,
    },
    tick,
    tickSpacing,
    opts.bandPct,
    opts.blockNumber,
  )
  return {
    kind: 'concentrated',
    blockNumber: opts.blockNumber,
    timestamp: opts.timestamp,
    sqrtPriceX96: asBigint(slot0[0], 'sqrtPriceX96'),
    tick,
    liquidity: asBigint(expectResult(base[1], `${pool.id} liquidity`), 'liquidity'),
    feePips: asNumber(expectResult(base[2], `${pool.id} fee`), 'fee'),
    tickSpacing,
    ...walk,
  }
}

export interface NfpmSpec {
  positionManager: Address
  abi: typeof nonfungiblePositionManagerAbi | typeof slipstreamNFPMAbi
  /** Fifth `positions()` output the pool must match: v3 fee (pips) or Slipstream tickSpacing. */
  keyValue: number
}

/** Distinct tokenIds touched by IncreaseLiquidity / DecreaseLiquidity / Transfer in the range. */
export async function collectNfpmTokenIds(
  ctx: ReaderContext,
  spec: NfpmSpec,
  range: BlockRange,
): Promise<bigint[]> {
  const increase = eventTopics(spec.abi, 'IncreaseLiquidity')
  const decrease = eventTopics(spec.abi, 'DecreaseLiquidity')
  const transfer = eventTopics(spec.abi, 'Transfer')
  const logs = await fetchLogs(
    ctx,
    { address: spec.positionManager, topics: [[increase, decrease, transfer]] },
    range.fromBlock,
    range.toBlock,
  )
  const ids = new Set<bigint>()
  for (const log of logs) {
    const topic0 = log.topics[0]?.toLowerCase()
    const idTopic = topic0 === transfer ? log.topics[3] : log.topics[1]
    if (idTopic) ids.add(hexToBigInt(idTopic))
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function fetchNfpmRecords(
  ctx: ReaderContext,
  spec: NfpmSpec,
  range: BlockRange,
): Promise<NfpmTokenRecord[]> {
  const tokenIds = await collectNfpmTokenIds(ctx, spec, range)
  if (tokenIds.length === 0) return []
  const calls = tokenIds.flatMap((id) => [
    { address: spec.positionManager, abi: spec.abi, functionName: 'positions', args: [id] },
    { address: spec.positionManager, abi: spec.abi, functionName: 'ownerOf', args: [id] },
  ])
  const results = await multicallBatched(ctx, calls)
  return tokenIds.map((tokenId, i) => {
    const raw = optionalResult(results[i * 2])
    const owner = optionalResult(results[i * 2 + 1])
    return {
      tokenId,
      position: Array.isArray(raw) ? (raw as unknown as NfpmPositionsTuple) : undefined,
      owner: typeof owner === 'string' ? lowercase(owner) : undefined,
    }
  })
}

/**
 * Every token of `spec.positionManager` touched in `range`, with its latest `positions()` and
 * `ownerOf()`. Cached per NFPM for the most recent range (see `ReaderContext.nfpmCache`); a failed
 * fetch is evicted so the next call retries.
 */
export function nfpmSnapshot(
  ctx: ReaderContext,
  spec: NfpmSpec,
  range: BlockRange,
): Promise<NfpmTokenRecord[]> {
  return rangeSnapshot(ctx.nfpmCache, spec.positionManager, range, () =>
    fetchNfpmRecords(ctx, spec, range),
  )
}

/**
 * Positions of `pool` held through an NFPM: tokenIds from the logs, then `positions()` +
 * `ownerOf()` (latest state) via multicall, filtered to the pool key and liquidity > 0. Owners are
 * reported as-is: a staked Slipstream NFT belongs to its CLGauge and shows the gauge as owner.
 */
export async function readNfpmPositions(
  ctx: ReaderContext,
  spec: NfpmSpec,
  pool: PoolMeta,
  range: BlockRange,
): Promise<Position[]> {
  const records = await nfpmSnapshot(ctx, spec, range)
  const out: Position[] = []
  for (const { tokenId, position: p, owner } of records) {
    if (!p || !owner) continue
    if (lowercase(p[2]) !== pool.token0.address || lowercase(p[3]) !== pool.token1.address) continue
    if (p[4] !== spec.keyValue || p[7] <= 0n) continue
    out.push({ owner, tickLower: p[5], tickUpper: p[6], liquidity: p[7], tokenId })
  }
  return out
}

/**
 * v3 / Slipstream `Swap`: amount0/amount1 are pool deltas (positive = received by the pool).
 * Slipstream's CLPool emits Uniswap v3's `Swap` event unchanged (same signature, hence the same
 * topic0, pinned by reader.swapScans.test.ts), so both adapters use this function and the reader
 * reads the pools of both DEXes in one filter per range.
 */
export async function readV3StyleSwaps(
  ctx: ReaderContext,
  pools: PoolMeta[],
  fromBlock: bigint,
  toBlock: bigint,
  observer?: LogScanObserver,
): Promise<SwapEvent[]> {
  const byAddress = new Map<Address, PoolMeta>()
  for (const pool of pools) if (pool.address) byAddress.set(pool.address, pool)
  if (byAddress.size === 0) return []
  const logs = await fetchLogs(
    ctx,
    { address: [...byAddress.keys()], topics: [eventTopics(uniswapV3PoolAbi, 'Swap')] },
    fromBlock,
    toBlock,
    observer,
  )
  return decodeLogs(uniswapV3PoolAbi, 'Swap', logs).flatMap((log) => {
    const pool = byAddress.get(log.address)
    if (!pool) return []
    return [
      {
        poolId: pool.id,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.txHash,
        amount0: log.args.amount0,
        amount1: log.args.amount1,
        timestamp: null,
      },
    ]
  })
}
