/**
 * Uniswap v4 pool identity and discovery: PoolKey → PoolId, the PoolManager `Initialize` scan and
 * the PoolMeta builder that seeded discovery (seed/) shares with it. Pools are keyed by PoolId,
 * `address` is null, `currency0 == address(0)` is native ETH. Dynamic-fee pools (fee == 0x800000)
 * store the `lpFee` StateView reports when they are discovered.
 */
import type { Address, Hex, PoolMeta } from '@depthwatch/core'
import { encodeAbiParameters, keccak256 } from 'viem'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import { v4StateViewAbi } from '../abi/v4StateView.js'
import { lowercase, type ReaderContext } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs } from '../internal/logs.js'
import { asNumber, multicallBatched, optionalResult } from '../internal/multicall.js'
import { readTokens, tokenMap } from '../internal/tokens.js'
import { tokenOrThrow } from './shared.js'

export const DEX = 'uniswap-v4' as const
export const DYNAMIC_FEE_FLAG = 0x800000

export interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/** keccak256(abi.encode(PoolKey)), as `PoolIdLibrary.toId`. */
export function computePoolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  )
}

export function uniswapV4PoolId(poolId: string): string {
  return `${DEX}:${poolId.toLowerCase()}`
}

/** A v4 pool as its `Initialize` event, or a seeded PoolKey StateView reports, describes it. */
export interface UniswapV4PoolRecord extends PoolKey {
  id: Hex
  /** Initialization block. */
  blockNumber: bigint
}

/** PoolMeta of v4 pools: token metadata (cached) and, for dynamic-fee pools, StateView's `lpFee`. */
export async function uniswapV4PoolMetas(
  ctx: ReaderContext,
  records: readonly UniswapV4PoolRecord[],
): Promise<PoolMeta[]> {
  if (records.length === 0) return []
  const tokens = tokenMap(
    await readTokens(
      ctx,
      records.flatMap((r) => [r.currency0, r.currency1]),
    ),
  )
  const dynamic = records.filter((r) => r.fee === DYNAMIC_FEE_FLAG)
  const slot0s = await multicallBatched(
    ctx,
    dynamic.map((r) => ({
      address: ctx.addresses.uniswapV4.stateView,
      abi: v4StateViewAbi,
      functionName: 'getSlot0',
      args: [r.id],
    })),
  )
  const dynamicFee = new Map<string, number>()
  dynamic.forEach((r, i) => {
    const slot0 = optionalResult(slot0s[i])
    if (Array.isArray(slot0)) dynamicFee.set(r.id.toLowerCase(), asNumber(slot0[3], 'lpFee'))
  })
  return records.map((r) => {
    const poolId = r.id.toLowerCase() as Hex
    return {
      id: uniswapV4PoolId(poolId),
      dex: DEX,
      kind: 'concentrated',
      address: null,
      poolId,
      token0: tokenOrThrow(tokens, r.currency0),
      token1: tokenOrThrow(tokens, r.currency1),
      feePips: r.fee === DYNAMIC_FEE_FLAG ? (dynamicFee.get(poolId) ?? 0) : r.fee,
      tickSpacing: r.tickSpacing,
      stable: false,
      hooks: lowercase(r.hooks),
      createdAtBlock: r.blockNumber,
    }
  })
}

/** PoolManager `Initialize` logs in the range → PoolMeta. */
export async function discoverUniswapV4(
  ctx: ReaderContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolMeta[]> {
  const logs = await fetchLogs(
    ctx,
    {
      address: ctx.addresses.uniswapV4.poolManager,
      topics: [eventTopics(v4PoolManagerAbi, 'Initialize')],
    },
    fromBlock,
    toBlock,
  )
  return uniswapV4PoolMetas(
    ctx,
    decodeLogs(v4PoolManagerAbi, 'Initialize', logs).map(({ args, blockNumber }) => ({
      id: args.id,
      currency0: args.currency0,
      currency1: args.currency1,
      fee: args.fee,
      tickSpacing: args.tickSpacing,
      hooks: args.hooks,
      blockNumber,
    })),
  )
}
