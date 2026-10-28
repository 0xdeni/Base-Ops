/**
 * Aerodrome v2 AMM pools (volatile x·y = k and stable x³y + xy³ = k). The fee lives on the
 * PoolFactory (`getFee(pool, stable)`, basis points → ×100 for pips) and can change per pool via
 * `SetCustomFee`, so it is re-read with every state read. No per-LP positions (fungible LP token).
 *
 * Aero v2 pools (./aeroV2.ts) answer the same `getReserves` and emit the same `Swap`, so the
 * overview, the reserve state, the swap reader (one function object: one shared log scan) and the
 * LP-holdings read, given the pool's gauge lookup, are exported for that adapter.
 */
import type { Address, LpHolding, PoolMeta, PoolState, SwapEvent } from '@depthwatch/core'
import { aerodromeGaugeAbi } from '../abi/aerodromeGauge.js'
import { aerodromePoolAbi } from '../abi/aerodromePool.js'
import { aerodromePoolFactoryAbi } from '../abi/aerodromePoolFactory.js'
import { aerodromeVoterAbi } from '../abi/aerodromeVoter.js'
import { erc20Abi } from '../abi/erc20.js'
import { lowercase, type ReaderContext, unique, ZERO_ADDRESS } from '../internal/context.js'
import { decodeLogs, eventTopics, fetchLogs, type LogScanObserver } from '../internal/logs.js'
import {
  asBigint,
  asTuple,
  type ContractCall,
  expectResult,
  multicallBatched,
} from '../internal/multicall.js'
import { readTokens, tokenMap } from '../internal/tokens.js'
import type { DexAdapter, PoolOverview, StateOptions } from '../internal/types.js'
import { requireAddress, tokenOrThrow } from './shared.js'

export const DEX = 'aerodrome-v2' as const

export function aerodromeV2PoolId(address: string): string {
  return `${DEX}:${lowercase(address)}`
}

/** Factory fee in basis points → pips. */
export function bpsToPips(bps: bigint): number {
  return Number(bps) * 100
}

/** An Aerodrome v2 pool as its `PoolCreated` event, or a seeded `getPool` answer, describes it. */
export interface AerodromeV2PoolRecord {
  pool: Address
  token0: Address
  token1: Address
  stable: boolean
  /** Creation block. */
  blockNumber: bigint
}

/** PoolMeta of Aerodrome v2 pools: token metadata (cached) and `PoolFactory.getFee` per pool. */
export async function aerodromeV2PoolMetas(
  ctx: ReaderContext,
  records: readonly AerodromeV2PoolRecord[],
): Promise<PoolMeta[]> {
  if (records.length === 0) return []
  const factory = ctx.addresses.aerodromeV2.poolFactory
  const tokens = tokenMap(
    await readTokens(
      ctx,
      records.flatMap((r) => [r.token0, r.token1]),
    ),
  )
  const fees = await multicallBatched(
    ctx,
    records.map((r) => ({
      address: factory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getFee',
      args: [lowercase(r.pool), r.stable],
    })),
  )
  return records.map((r, i) => ({
    id: aerodromeV2PoolId(r.pool),
    dex: DEX,
    kind: r.stable ? 'stable-swap' : 'constant-product',
    address: lowercase(r.pool),
    poolId: null,
    token0: tokenOrThrow(tokens, r.token0),
    token1: tokenOrThrow(tokens, r.token1),
    feePips: bpsToPips(asBigint(expectResult(fees[i], `getFee(${r.pool})`), 'fee')),
    tickSpacing: null,
    stable: r.stable,
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
      address: ctx.addresses.aerodromeV2.poolFactory,
      topics: [eventTopics(aerodromePoolFactoryAbi, 'PoolCreated')],
    },
    fromBlock,
    toBlock,
  )
  return aerodromeV2PoolMetas(
    ctx,
    decodeLogs(aerodromePoolFactoryAbi, 'PoolCreated', logs).map(({ args, blockNumber }) => ({
      pool: args.pool,
      token0: args.token0,
      token1: args.token1,
      stable: args.stable,
      blockNumber,
    })),
  )
}

/** Reserves of v2-style pools (`getReserves`), one multicall. */
export async function overviewReserves(
  ctx: ReaderContext,
  pools: PoolMeta[],
  blockNumber: bigint,
): Promise<PoolOverview[]> {
  const results = await multicallBatched(
    ctx,
    pools.map((pool) => ({
      address: requireAddress(pool),
      abi: aerodromePoolAbi,
      functionName: 'getReserves',
    })),
    blockNumber,
  )
  return pools.map((pool, i) => {
    const reserves = asTuple(expectResult(results[i], `${pool.id} getReserves`), 'getReserves')
    return {
      pool,
      blockNumber,
      sqrtPriceX96: null,
      tick: null,
      liquidity: null,
      reserve0: asBigint(reserves[0], 'reserve0'),
      reserve1: asBigint(reserves[1], 'reserve1'),
    }
  })
}

/** A v2 pool's state from its `getReserves` answer and its fee (stable pools keep decimals). */
export function reserveState(
  pool: PoolMeta,
  opts: StateOptions,
  reserves: unknown,
  feePips: number,
): PoolState {
  const tuple = asTuple(reserves, 'getReserves')
  const common = {
    blockNumber: opts.blockNumber,
    timestamp: opts.timestamp,
    reserve0: asBigint(tuple[0], 'reserve0'),
    reserve1: asBigint(tuple[1], 'reserve1'),
    feePips,
  }
  return pool.stable
    ? {
        kind: 'stable-swap',
        ...common,
        decimals0: pool.token0.decimals,
        decimals1: pool.token1.decimals,
      }
    : { kind: 'constant-product', ...common }
}

async function state(ctx: ReaderContext, pool: PoolMeta, opts: StateOptions): Promise<PoolState> {
  const address = requireAddress(pool)
  const results = await multicallBatched(
    ctx,
    [
      { address, abi: aerodromePoolAbi, functionName: 'getReserves' },
      {
        address: ctx.addresses.aerodromeV2.poolFactory,
        abi: aerodromePoolFactoryAbi,
        functionName: 'getFee',
        args: [address, pool.stable],
      },
    ],
    opts.blockNumber,
  )
  const reserves = expectResult(results[0], `${pool.id} getReserves`)
  const feePips = bpsToPips(asBigint(expectResult(results[1], `${pool.id} getFee`), 'fee'))
  return reserveState(pool, opts, reserves, feePips)
}

/**
 * Aerodrome `Swap` carries in/out amounts; net pool delta = in − out (positive = into the pool).
 * Aero v2 pools emit the same event (topic0 pinned by reader.swapScans.test.ts), so both adapters
 * use this function and the reader reads their pools in one filter per range.
 */
export async function readV2StyleSwaps(
  ctx: ReaderContext,
  pools: PoolMeta[],
  fromBlock: bigint,
  toBlock: bigint,
  observer?: LogScanObserver,
): Promise<SwapEvent[]> {
  const byAddress = new Map(
    pools.filter((p) => p.address).map((p) => [p.address as `0x${string}`, p]),
  )
  if (byAddress.size === 0) return []
  const logs = await fetchLogs(
    ctx,
    { address: [...byAddress.keys()], topics: [eventTopics(aerodromePoolAbi, 'Swap')] },
    fromBlock,
    toBlock,
    observer,
  )
  return decodeLogs(aerodromePoolAbi, 'Swap', logs).flatMap((log) => {
    const pool = byAddress.get(log.address)
    if (!pool) return []
    return [
      {
        poolId: pool.id,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.txHash,
        amount0: log.args.amount0In - log.args.amount0Out,
        amount1: log.args.amount1In - log.args.amount1Out,
        timestamp: null,
      },
    ]
  })
}

/** How a v2 adapter finds a pool's gauge: one call answering its address (0 without one). */
export interface GaugeLookup {
  call: ContractCall
  /** Names the call in errors (`Voter.gauges`, `FactoryRegistry.targetToGauge`). */
  what: string
}

/**
 * LP-token holdings of `addresses` (deduplicated, lowercased, input order kept): the pool is the LP
 * token (`balanceOf`, `totalSupply`), and when `gauge` answers a gauge for it (≠ address(0)) the
 * LP tokens staked there (`Gauge.balanceOf`) count as `staked`. Two multicalls at most: the gauge
 * lookup rides along with the wallet reads, the gauge balances follow.
 */
export async function readLpHoldingsVia(
  ctx: ReaderContext,
  pool: PoolMeta,
  addresses: readonly Address[],
  blockNumber: bigint | undefined,
  gauge: GaugeLookup,
): Promise<LpHolding[]> {
  const owners = unique(addresses.map(lowercase))
  if (owners.length === 0) return []
  const lpToken = requireAddress(pool)
  const base = await multicallBatched(
    ctx,
    [
      { address: lpToken, abi: erc20Abi, functionName: 'totalSupply' },
      gauge.call,
      ...owners.map((owner) => ({
        address: lpToken,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [owner],
      })),
    ],
    blockNumber,
  )
  const totalSupply = asBigint(expectResult(base[0], `${pool.id} totalSupply`), 'totalSupply')
  const gaugeAddress = lowercase(String(expectResult(base[1], `${pool.id} ${gauge.what}`)))
  const staked =
    gaugeAddress === ZERO_ADDRESS
      ? []
      : await multicallBatched(
          ctx,
          owners.map((owner) => ({
            address: gaugeAddress,
            abi: aerodromeGaugeAbi,
            functionName: 'balanceOf' as const,
            args: [owner],
          })),
          blockNumber,
        )
  return owners.map((address, i) => ({
    address,
    balance: asBigint(expectResult(base[i + 2], `${pool.id} balanceOf(${address})`), 'balance'),
    staked:
      gaugeAddress === ZERO_ADDRESS
        ? 0n
        : asBigint(expectResult(staked[i], `${gaugeAddress} balanceOf(${address})`), 'staked'),
    totalSupply,
  }))
}

/** Aerodrome v2 holdings: the gauge is `Voter.gauges(pool)` (killed gauges are still returned). */
export function readLpHoldings(
  ctx: ReaderContext,
  pool: PoolMeta,
  addresses: readonly Address[],
  blockNumber?: bigint,
): Promise<LpHolding[]> {
  return readLpHoldingsVia(ctx, pool, addresses, blockNumber, {
    call: {
      address: ctx.addresses.aerodromeV2.voter,
      abi: aerodromeVoterAbi,
      functionName: 'gauges',
      args: [requireAddress(pool)],
    },
    what: 'Voter.gauges',
  })
}

export const aerodromeV2Adapter: DexAdapter = {
  dex: DEX,
  discover,
  overview: overviewReserves,
  state,
  positions: async () => [],
  swaps: readV2StyleSwaps,
  lpHoldings: readLpHoldings,
}
