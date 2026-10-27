import type {
  Address,
  Dex,
  Hex,
  LpHolding,
  PoolMeta,
  PoolState,
  Position,
  SwapEvent,
} from '@depthwatch/core'
import type { ReaderContext } from './context.js'
import type { LogScanObserver } from './logs.js'

export interface PoolOverview {
  pool: PoolMeta
  blockNumber: bigint
  sqrtPriceX96: bigint | null
  tick: number | null
  /** Active liquidity for concentrated pools; null otherwise. */
  liquidity: bigint | null
  /** Token balances for TVL. Uniswap v4: 0n (singleton PoolManager; see adapters/uniswapV4.ts). */
  reserve0: bigint
  reserve1: bigint
}

export interface StateOptions {
  bandPct: number
  blockNumber: bigint
  timestamp: number
}

export interface BlockRange {
  fromBlock: bigint
  toBlock: bigint
}

/** Decoded `positions(tokenId)` of a v3-style NFPM (5th output: v3 fee or Slipstream tickSpacing). */
export type NfpmPositionsTuple = readonly [
  nonce: bigint,
  operator: Address,
  token0: Address,
  token1: Address,
  key: number,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  feeGrowthInside0LastX128: bigint,
  feeGrowthInside1LastX128: bigint,
  tokensOwed0: bigint,
  tokensOwed1: bigint,
]

/** One NFPM tokenId touched in a block range with its latest `positions()` / `ownerOf()`. */
export interface NfpmTokenRecord {
  tokenId: bigint
  /** Undefined when `positions()` reverted (burned token). */
  position: NfpmPositionsTuple | undefined
  /** Undefined when `ownerOf()` reverted (burned token). */
  owner: Address | undefined
}

/** Records fetched once for one block range and shared by every pool of a position manager. */
export interface RangeSnapshot<T> {
  rangeKey: string
  records: Promise<T[]>
}

/** Per-NFPM snapshot of every token touched in one block range, shared by all pools of that NFPM. */
export type NfpmSnapshot = RangeSnapshot<NfpmTokenRecord>

/** One Uniswap v4 PositionManager tokenId with its latest owner, pool, range and liquidity. */
export interface V4TokenRecord {
  tokenId: bigint
  /** Undefined when `ownerOf()` reverted (burned token). */
  owner: Address | undefined
  /** From `getPoolAndPositionInfo()`; undefined when it reverted. */
  position: { poolId: Hex; tickLower: number; tickUpper: number } | undefined
  /** `getPositionLiquidity()`; 0n when it reverted. */
  liquidity: bigint
}

/** Per-PositionManager snapshot of every v4 NFT transferred in one block range. */
export type V4TransferSnapshot = RangeSnapshot<V4TokenRecord>

/** Internal per-DEX adapter contract composed by `createChainReader`. */
export interface DexAdapter {
  readonly dex: Dex
  discover(ctx: ReaderContext, fromBlock: bigint, toBlock: bigint): Promise<PoolMeta[]>
  overview(ctx: ReaderContext, pools: PoolMeta[], blockNumber: bigint): Promise<PoolOverview[]>
  state(ctx: ReaderContext, pool: PoolMeta, opts: StateOptions): Promise<PoolState>
  positions(ctx: ReaderContext, pool: PoolMeta, range: BlockRange): Promise<Position[]>
  /**
   * Swap events without timestamps (the reader fills them). Adapters whose pools emit the same
   * `Swap` event share one function, and the reader reads their pools in one filter.
   */
  swaps(
    ctx: ReaderContext,
    pools: PoolMeta[],
    fromBlock: bigint,
    toBlock: bigint,
    observer?: LogScanObserver,
  ): Promise<SwapEvent[]>
  /** LP-token holdings (wallet + gauge-staked) of `addresses`; only fungible-LP DEXes implement it. */
  lpHoldings?(
    ctx: ReaderContext,
    pool: PoolMeta,
    addresses: readonly Address[],
    blockNumber?: bigint,
  ): Promise<LpHolding[]>
  /** Rewrites gauge-owned positions to their depositor among `candidates`; absent = nothing to resolve. */
  stakedOwners?(
    ctx: ReaderContext,
    pool: PoolMeta,
    positions: readonly Position[],
    candidates: readonly Address[],
    blockNumber?: bigint,
  ): Promise<Position[]>
}
