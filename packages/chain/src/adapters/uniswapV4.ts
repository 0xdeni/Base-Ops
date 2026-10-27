/**
 * Uniswap v4 on Base (singleton PoolManager, StateView lens, PositionManager NFTs).
 *
 * Conventions and limitations:
 * - PoolId = keccak256(abi.encode(PoolKey)); pools are keyed by it, `address` is null.
 * - `Swap.amount0/amount1` are the swapper's balance delta (negative = paid into the pool); they
 *   are negated here so `SwapEvent` follows DESIGN (positive = flowed into the pool).
 * - Overview reserves are 0n: the PoolManager holds every pool's currencies in one contract and
 *   per-pool balances are not readable cheaply; use `liquidity` for TVL-like ranking.
 * - Positions: PositionManager NFTs are found through PoolManager `ModifyLiquidity` logs whose
 *   `sender` is the PositionManager (`salt == bytes32(tokenId)`) and through PositionManager
 *   `Transfer` logs (an owner change emits no `ModifyLiquidity`; transferred tokens are read once
 *   per range for every v4 pool and filtered by pool, like the v3 NFPM snapshot), then `ownerOf` /
 *   `getPoolAndPositionInfo` / `getPositionLiquidity`. Other senders (hooks, vaults) are read as
 *   direct positions via `StateView.getPositionInfo(poolId, sender, tickLower, tickUpper, salt)`.
 * - Pool identity (PoolKey → PoolId), the `Initialize` scan and the PoolMeta builder shared with
 *   seeded discovery live in ./uniswapV4Pools.ts; dynamic-fee pools (fee == 0x800000) store the
 *   `lpFee` read from StateView at discovery.
 * - State: `feePips` is slot0's `lpFee` (the pool's displayed fee) and `protocolFeePips` its
 *   `protocolFee` per direction; swaps are simulated with the two combined (core
 *   swap/protocolFee.ts). A hook's per-swap LP fee override cannot be read and is not modelled.
 */
import {
  type Address,
  decodeV4ProtocolFee,
  type Hex,
  type PoolMeta,
  type PoolState,
  type Position,
  type SwapEvent,
} from '@depthwatch/core'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import { v4PositionManagerAbi } from '../abi/v4PositionManager.js'
import { v4StateViewAbi } from '../abi/v4StateView.js'
import { lowercase, type ReaderContext } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs, type LogScanObserver } from '../internal/logs.js'
import {
  asBigint,
  asNumber,
  asTuple,
  type CallResult,
  type ContractCall,
  expectResult,
  multicallBatched,
  optionalResult,
} from '../internal/multicall.js'
import { rangeSnapshot } from '../internal/snapshot.js'
import { decodeGrossNet, readTicks } from '../internal/ticks.js'
import type {
  BlockRange,
  DexAdapter,
  PoolOverview,
  StateOptions,
  V4TokenRecord,
} from '../internal/types.js'
import { computePoolId, DEX, discoverUniswapV4, type PoolKey } from './uniswapV4Pools.js'

export {
  computePoolId,
  DEX,
  DYNAMIC_FEE_FLAG,
  type PoolKey,
  type UniswapV4PoolRecord,
  uniswapV4PoolId,
  uniswapV4PoolMetas,
} from './uniswapV4Pools.js'

function requirePoolId(pool: PoolMeta): Hex {
  if (!pool.poolId) throw new Error(`pool ${pool.id} has no v4 PoolId`)
  return pool.poolId
}

function toInt24(x: number): number {
  return x >= 2 ** 23 ? x - 2 ** 24 : x
}

/** Unpack PositionManager `positionInfo`: 200 bits poolId | 24 tickUpper | 24 tickLower | 8 flags. */
export function decodePositionInfo(info: bigint): { tickLower: number; tickUpper: number } {
  return {
    tickUpper: toInt24(Number((info >> 32n) & 0xffffffn)),
    tickLower: toInt24(Number((info >> 8n) & 0xffffffn)),
  }
}

function stateViewCalls(ctx: ReaderContext, poolId: Hex) {
  const address = ctx.addresses.uniswapV4.stateView
  return [
    { address, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolId] },
    { address, abi: v4StateViewAbi, functionName: 'getLiquidity', args: [poolId] },
  ]
}

async function overview(
  ctx: ReaderContext,
  pools: PoolMeta[],
  blockNumber: bigint,
): Promise<PoolOverview[]> {
  const results = await multicallBatched(
    ctx,
    pools.flatMap((p) => stateViewCalls(ctx, requirePoolId(p))),
    blockNumber,
  )
  return pools.map((pool, i) => {
    const slot0 = asTuple(expectResult(results[i * 2], `${pool.id} getSlot0`), 'getSlot0')
    return {
      pool,
      blockNumber,
      sqrtPriceX96: asBigint(slot0[0], 'sqrtPriceX96'),
      tick: asNumber(slot0[1], 'tick'),
      liquidity: asBigint(expectResult(results[i * 2 + 1], `${pool.id} getLiquidity`), 'liquidity'),
      reserve0: 0n,
      reserve1: 0n,
    }
  })
}

async function state(ctx: ReaderContext, pool: PoolMeta, opts: StateOptions): Promise<PoolState> {
  const poolId = requirePoolId(pool)
  if (pool.tickSpacing === null) throw new Error(`pool ${pool.id} has no tickSpacing`)
  const tickSpacing = pool.tickSpacing
  const stateView = ctx.addresses.uniswapV4.stateView
  const base = await multicallBatched(ctx, stateViewCalls(ctx, poolId), opts.blockNumber)
  const slot0 = asTuple(expectResult(base[0], `${pool.id} getSlot0`), 'getSlot0')
  const tick = asNumber(slot0[1], 'tick')
  const walk = await readTicks(
    ctx,
    {
      bitmapCall: (word) => ({
        address: stateView,
        abi: v4StateViewAbi,
        functionName: 'getTickBitmap',
        args: [poolId, word],
      }),
      tickCall: (t) => ({
        address: stateView,
        abi: v4StateViewAbi,
        functionName: 'getTickInfo',
        args: [poolId, t],
      }),
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
    liquidity: asBigint(expectResult(base[1], `${pool.id} getLiquidity`), 'liquidity'),
    feePips: asNumber(slot0[3], 'lpFee'),
    protocolFeePips: decodeV4ProtocolFee(asNumber(slot0[2], 'protocolFee')),
    tickSpacing,
    ...walk,
  }
}

interface DirectKey {
  owner: Address
  tickLower: number
  tickUpper: number
  salt: Hex
}

function sortIds(ids: Iterable<bigint>): bigint[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** `ownerOf` / `getPoolAndPositionInfo` / `getPositionLiquidity` of one PositionManager token. */
function posmTokenCalls(posm: Address, id: bigint): ContractCall[] {
  const abi = v4PositionManagerAbi
  return [
    { address: posm, abi, functionName: 'ownerOf', args: [id] },
    { address: posm, abi, functionName: 'getPoolAndPositionInfo', args: [id] },
    { address: posm, abi, functionName: 'getPositionLiquidity', args: [id] },
  ]
}

/** Decode the three `posmTokenCalls` answers starting at `results[offset]`. */
function decodePosmToken(tokenId: bigint, results: CallResult[], offset: number): V4TokenRecord {
  const owner = optionalResult(results[offset])
  const info = optionalResult(results[offset + 1])
  const liquidity = optionalResult(results[offset + 2])
  let position: V4TokenRecord['position']
  if (Array.isArray(info) && typeof info[1] === 'bigint') {
    const key = info[0] as PoolKey
    position = {
      poolId: computePoolId({
        ...key,
        currency0: lowercase(key.currency0),
        currency1: lowercase(key.currency1),
        hooks: lowercase(key.hooks),
      }),
      ...decodePositionInfo(info[1]),
    }
  }
  return {
    tokenId,
    owner: typeof owner === 'string' ? lowercase(owner) : undefined,
    position,
    liquidity: typeof liquidity === 'bigint' ? liquidity : 0n,
  }
}

/** Latest state of every PositionManager token transferred (minted, sold, moved, burned) in `range`. */
async function fetchTransferredTokens(
  ctx: ReaderContext,
  posm: Address,
  range: BlockRange,
): Promise<V4TokenRecord[]> {
  const logs = await fetchLogs(
    ctx,
    { address: posm, topics: [eventTopics(v4PositionManagerAbi, 'Transfer')] },
    range.fromBlock,
    range.toBlock,
  )
  const ids = sortIds(
    new Set(decodeLogs(v4PositionManagerAbi, 'Transfer', logs).map((l) => l.args.id)),
  )
  const results = await multicallBatched(
    ctx,
    ids.flatMap((id) => posmTokenCalls(posm, id)),
  )
  return ids.map((id, i) => decodePosmToken(id, results, i * 3))
}

/**
 * Tokens transferred in `range` with their latest state, fetched once per range for every v4 pool
 * (`Transfer` logs carry no pool; see `ReaderContext.v4TransferCache`) and filtered per pool.
 */
function transferSnapshot(
  ctx: ReaderContext,
  posm: Address,
  range: BlockRange,
): Promise<V4TokenRecord[]> {
  return rangeSnapshot(ctx.v4TransferCache, posm, range, () =>
    fetchTransferredTokens(ctx, posm, range),
  )
}

async function positions(
  ctx: ReaderContext,
  pool: PoolMeta,
  range: BlockRange,
): Promise<Position[]> {
  const poolId = requirePoolId(pool)
  const posm = lowercase(ctx.addresses.uniswapV4.positionManager)
  const stateView = ctx.addresses.uniswapV4.stateView
  const [logs, transferred] = await Promise.all([
    fetchLogs(
      ctx,
      {
        address: ctx.addresses.uniswapV4.poolManager,
        topics: [eventTopics(v4PoolManagerAbi, 'ModifyLiquidity'), poolId],
      },
      range.fromBlock,
      range.toBlock,
    ),
    transferSnapshot(ctx, posm, range),
  ])
  const modified = new Set<bigint>()
  const direct = new Map<string, DirectKey>()
  for (const log of decodeLogs(v4PoolManagerAbi, 'ModifyLiquidity', logs)) {
    const sender = lowercase(log.args.sender)
    if (sender === posm) modified.add(BigInt(log.args.salt))
    else {
      const key: DirectKey = {
        owner: sender,
        tickLower: log.args.tickLower,
        tickUpper: log.args.tickUpper,
        salt: log.args.salt,
      }
      direct.set(`${key.owner}:${key.tickLower}:${key.tickUpper}:${key.salt}`, key)
    }
  }
  // Tokens already in the transfer snapshot carry their latest state; read only the others here.
  const seen = new Set(transferred.map((r) => r.tokenId))
  const ids = sortIds([...modified].filter((id) => !seen.has(id)))
  const directs = [...direct.values()]
  const results = await multicallBatched(ctx, [
    ...ids.flatMap((id) => posmTokenCalls(posm, id)),
    ...directs.map((d) => ({
      address: stateView,
      abi: v4StateViewAbi,
      functionName: 'getPositionInfo',
      args: [poolId, d.owner, d.tickLower, d.tickUpper, d.salt],
    })),
  ])
  const records = [...transferred, ...ids.map((id, i) => decodePosmToken(id, results, i * 3))].sort(
    (a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0),
  )
  const out: Position[] = []
  for (const { tokenId, owner, position, liquidity } of records) {
    if (!owner || !position || position.poolId !== poolId || liquidity <= 0n) continue
    const { tickLower, tickUpper } = position
    out.push({ owner, tickLower, tickUpper, liquidity, tokenId })
  }
  directs.forEach((d, j) => {
    const info = optionalResult(results[ids.length * 3 + j])
    if (!Array.isArray(info) || typeof info[0] !== 'bigint' || info[0] <= 0n) return
    out.push({
      owner: d.owner,
      tickLower: d.tickLower,
      tickUpper: d.tickUpper,
      liquidity: info[0],
      tokenId: null,
    })
  })
  return out
}

async function swaps(
  ctx: ReaderContext,
  pools: PoolMeta[],
  fromBlock: bigint,
  toBlock: bigint,
  observer?: LogScanObserver,
): Promise<SwapEvent[]> {
  const byPoolId = new Map(pools.filter((p) => p.poolId).map((p) => [p.poolId as Hex, p]))
  if (byPoolId.size === 0) return []
  const logs = await fetchLogs(
    ctx,
    {
      address: ctx.addresses.uniswapV4.poolManager,
      topics: [eventTopics(v4PoolManagerAbi, 'Swap'), [...byPoolId.keys()]],
    },
    fromBlock,
    toBlock,
    observer,
  )
  return decodeLogs(v4PoolManagerAbi, 'Swap', logs).flatMap((log) => {
    const pool = byPoolId.get(log.args.id.toLowerCase() as Hex)
    if (!pool) return []
    return [
      {
        poolId: pool.id,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.txHash,
        amount0: -log.args.amount0,
        amount1: -log.args.amount1,
        timestamp: null,
      },
    ]
  })
}

export const uniswapV4Adapter: DexAdapter = {
  dex: DEX,
  discover: discoverUniswapV4,
  overview,
  state,
  positions,
  swaps,
}
