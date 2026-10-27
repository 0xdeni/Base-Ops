/**
 * Types and constants of the synthetic Base world behind `createSyntheticFixture`: six pools with
 * realistic prices (ETH 2 500, cbBTC 65 000, AERO 1.2), a few LP positions each, reserves and
 * ~24 h of swaps. Everything is derived deterministically from `SyntheticOptions`.
 *
 * Two flavours: the *static* world (no epoch: the state at `latestBlock`, as it always was) and
 * the *time-varying* world (`epochTimestamp` / `epochBlock` set: the state at that moment, with
 * hourly liquidity cycles, price drift, hourly volume and scripted market-maker events; see
 * syntheticTime.ts).
 */
import type { Address, ConcentratedState, PoolMeta } from '@depthwatch/core'
import { keccak256, stringToHex } from 'viem'

export interface SyntheticOptions {
  /**
   * Head of the synthetic chain. In the time-varying world this is the *anchor* ("now" of the
   * world) that epochs, pool creation and the scripted events are measured against.
   */
  latestBlock?: bigint
  latestTimestamp?: number
  /**
   * Time-varying world: serve the state at this moment (unix seconds, between `latestTimestamp −
   * SYNTHETIC_HISTORY.maxAgeSeconds` and `latestTimestamp`). The fixture's head becomes the last
   * block at or before it (2 s blocks back from `latestBlock`).
   */
  epochTimestamp?: number
  /** Time-varying world by block instead (or as a check: both must name the same block). */
  epochBlock?: bigint
  /** Seed of the time-varying world's noise; same seed ⇒ identical fixture. Default 1. */
  seed?: number
}

/** ≈ Base mainnet height / time on 2026-10-23 00:00 UTC. */
export const SYNTHETIC_DEFAULTS = Object.freeze({
  latestBlock: 52_950_000n,
  latestTimestamp: 1_792_713_600,
  secondsPerBlock: 2,
  /** 24 h of 2 s blocks. */
  swapWindowBlocks: 43_200n,
  /** Seed of the time-varying world. */
  seed: 1,
})

/** Clock of the time-varying world: the anchor and the epoch the fixture serves. */
export interface SyntheticTimeline {
  anchorBlock: bigint
  anchorTimestamp: number
  seed: number
  epochBlock: bigint
  /** Timestamp of `epochBlock`. */
  epochTimestamp: number
  /** `floor(epochTimestamp / 3600)`: the hour whose state (liquidity, prices) the epoch shows. */
  epochHour: number
}

export const SYNTHETIC_PRICES = Object.freeze({ ETH: 2500, CBBTC: 65_000, AERO: 1.2, USD: 1 })

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/** Index into `ChainAddresses.aerodromeSlipstream` of the deployment that owns the synthetic pool. */
export const SLIPSTREAM_INITIAL_FACTORY_INDEX = 0

/** Deterministic fake address from a label. */
export function fakeAddress(label: string): Address {
  return `0x${keccak256(stringToHex(`depthwatch-synthetic:${label}`)).slice(26)}` as Address
}

/** Labels of the six synthetic pools, in discovery order (see syntheticWorld.ts). */
export const SYNTHETIC_POOL_LABELS = Object.freeze({
  wethUsdcV3: 'weth-usdc-v3-500',
  cbbtcUsdcV3: 'cbbtc-usdc-v3-3000',
  ethUsdcV4: 'eth-usdc-v4-500',
  usdcAeroV2: 'usdc-aero-v2-volatile',
  usdcUsdbcV2: 'usdc-usdbc-v2-stable',
  wethUsdcSlipstream: 'weth-usdc-slipstream-100',
})

/** Contract address of an address-keyed synthetic pool (not the v4 pool, which has a poolId). */
export function syntheticPoolAddress(label: string): Address {
  return fakeAddress(`pool:${label}`)
}

/** Gauge address of a synthetic pool (Aerodrome v2 Gauge or Slipstream CLGauge). */
export function syntheticGaugeAddress(label: string): Address {
  return fakeAddress(`gauge:${label}`)
}

/**
 * Gauges of the synthetic world: the Aerodrome v2 Gauges of both v2 pools (registered in the
 * Voter) and the CLGauge of the Slipstream pool (`CLPool.gauge()` and `Voter.gauges(pool)`).
 */
export const SYNTHETIC_GAUGES: Readonly<
  Record<'usdcAeroV2' | 'usdcUsdbcV2' | 'wethUsdcSlipstream', Address>
> = Object.freeze({
  usdcAeroV2: syntheticGaugeAddress(SYNTHETIC_POOL_LABELS.usdcAeroV2),
  usdcUsdbcV2: syntheticGaugeAddress(SYNTHETIC_POOL_LABELS.usdcUsdbcV2),
  wethUsdcSlipstream: syntheticGaugeAddress(SYNTHETIC_POOL_LABELS.wethUsdcSlipstream),
})

/** mulberry32 PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SYNTHETIC_OWNERS: readonly Address[] = Object.freeze([
  fakeAddress('lp-alice'),
  fakeAddress('lp-bob'),
  fakeAddress('lp-carol'),
  fakeAddress('lp-dave'),
])
export const SYNTHETIC_ROUTER: Address = fakeAddress('router')

export interface SyntheticPosition {
  /** Depositor: the economic owner (a gauge-staked position resolves back to it). */
  owner: Address
  /** `ownerOf` as the position manager reports it: the CLGauge for a staked position, else `owner`. */
  holder: Address
  tickLower: number
  tickUpper: number
  liquidity: bigint
  tokenId: bigint
  /** Token amounts at the current price (for IncreaseLiquidity logs). */
  amount0: bigint
  amount1: bigint
}

/**
 * Swap activity of a pool. Static world: a day's volume and swap count, spread over the 24 h
 * window before latest, at fixed USD prices. Time-varying world: the swaps actually in the 24 h
 * window before the epoch (hourly volume pattern) and the token prices at the epoch.
 */
export interface SyntheticActivity {
  volumeUsd: number
  swapCount: number
  token0Usd: number
  token1Usd: number
}

export interface SyntheticConcentratedPool extends SyntheticActivity {
  kind: 'concentrated'
  variant: 'v3' | 'slipstream' | 'v4'
  meta: PoolMeta
  state: ConcentratedState
  positions: SyntheticPosition[]
  /** Token balances held by the pool (sum of position amounts). */
  reserve0: bigint
  reserve1: bigint
  /** Slipstream: the pool's CLGauge (`CLPool.gauge()`); v3 / v4 pools have none. */
  gauge: Address | null
}

/** LP-token holding of one synthetic address in a v2 pool (wallet balance + gauge-staked). */
export interface SyntheticLpHolding {
  owner: Address
  balance: bigint
  staked: bigint
}

export interface SyntheticV2Pool extends SyntheticActivity {
  kind: 'v2'
  meta: PoolMeta
  reserve0: bigint
  reserve1: bigint
  feeBps: bigint
  /** LP-token total supply (√(reserve0·reserve1), as the first mint sets it). */
  lpTotalSupply: bigint
  /** The pool's Aerodrome v2 Gauge, registered in the Voter. */
  gauge: Address
  /** Holders with a non-zero wallet or staked balance; everyone else holds nothing. */
  lpHoldings: SyntheticLpHolding[]
}

export type SyntheticPool = SyntheticConcentratedPool | SyntheticV2Pool

export interface SyntheticWorld {
  /** Head of the fixture: the anchor in the static world, the epoch in the time-varying one. */
  latestBlock: bigint
  latestTimestamp: number
  secondsPerBlock: number
  swapWindowBlocks: bigint
  /** Set in the time-varying world; null for the static world. */
  timeline: SyntheticTimeline | null
  pools: SyntheticPool[]
}
