/**
 * Uniswap v3 on Base. Discovery reads `tickSpacing` from the `PoolCreated` event (never from a
 * fee→spacing table: fee tier 100 / spacing 1 is enabled on Base). Positions come from the
 * NonfungiblePositionManager; state from slot0/liquidity/tickBitmap/ticks on the pool.
 */
import type { Address, PoolMeta } from '@depthwatch/core'
import { nonfungiblePositionManagerAbi } from '../abi/nonfungiblePositionManager.js'
import { uniswapV3FactoryAbi } from '../abi/uniswapV3Factory.js'
import { uniswapV3PoolAbi } from '../abi/uniswapV3Pool.js'
import { lowercase, type ReaderContext } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs } from '../internal/logs.js'
import { readTokens, tokenMap } from '../internal/tokens.js'
import type { DexAdapter } from '../internal/types.js'
import {
  overviewAddressKeyed,
  readConcentratedAddressKeyed,
  readNfpmPositions,
  readV3StyleSwaps,
  tokenOrThrow,
} from './shared.js'

export const DEX = 'uniswap-v3' as const

export function uniswapV3PoolId(address: string): string {
  return `${DEX}:${lowercase(address)}`
}

/** A v3 pool as its `PoolCreated` event, or a seeded `getPool` answer, describes it. */
export interface UniswapV3PoolRecord {
  pool: Address
  token0: Address
  token1: Address
  fee: number
  tickSpacing: number
  /** Creation block. */
  blockNumber: bigint
}

/** PoolMeta of v3 pools, token metadata resolved through the reader's cache. */
export async function uniswapV3PoolMetas(
  ctx: ReaderContext,
  records: readonly UniswapV3PoolRecord[],
): Promise<PoolMeta[]> {
  if (records.length === 0) return []
  const tokens = tokenMap(
    await readTokens(
      ctx,
      records.flatMap((r) => [r.token0, r.token1]),
    ),
  )
  return records.map((r) => ({
    id: uniswapV3PoolId(r.pool),
    dex: DEX,
    kind: 'concentrated',
    address: lowercase(r.pool),
    poolId: null,
    token0: tokenOrThrow(tokens, r.token0),
    token1: tokenOrThrow(tokens, r.token1),
    feePips: r.fee,
    tickSpacing: r.tickSpacing,
    stable: false,
    hooks: null,
    createdAtBlock: r.blockNumber,
  }))
}

async function discover(
  ctx: ReaderContext,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolMeta[]> {
  const logs = await fetchLogs(
    ctx,
    {
      address: ctx.addresses.uniswapV3.factory,
      topics: [eventTopics(uniswapV3FactoryAbi, 'PoolCreated')],
    },
    fromBlock,
    toBlock,
  )
  return uniswapV3PoolMetas(
    ctx,
    decodeLogs(uniswapV3FactoryAbi, 'PoolCreated', logs).map(({ args, blockNumber }) => ({
      pool: args.pool,
      token0: args.token0,
      token1: args.token1,
      fee: args.fee,
      tickSpacing: args.tickSpacing,
      blockNumber,
    })),
  )
}

export const uniswapV3Adapter: DexAdapter = {
  dex: DEX,
  discover,
  overview: (ctx, pools, blockNumber) =>
    overviewAddressKeyed(ctx, pools, blockNumber, uniswapV3PoolAbi),
  state: (ctx, pool, opts) => readConcentratedAddressKeyed(ctx, pool, opts, uniswapV3PoolAbi),
  positions: (ctx, pool, range) =>
    readNfpmPositions(
      ctx,
      {
        positionManager: ctx.addresses.uniswapV3.positionManager,
        abi: nonfungiblePositionManagerAbi,
        keyValue: pool.feePips,
      },
      pool,
      range,
    ),
  swaps: readV3StyleSwaps,
}
