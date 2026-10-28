/**
 * Builders for the synthetic world's pools: tick data from positions, ids, reserves. Position
 * ranges are fixed around the spec's base price; the time-varying world passes per-hour factors
 * (price drift, liquidity multipliers, market-maker holdings) and the identity factors give the
 * static world.
 */
import {
  buildConcentratedState,
  type ConcentratedState,
  getAmount0Delta,
  getAmount1Delta,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  type PoolMeta,
  priceToSqrtPriceX96,
  sqrtBigint,
  type TokenInfo,
} from '@depthwatch/core'
import { slipstreamPoolId } from '../adapters/aerodromeSlipstream.js'
import { aerodromeV2PoolId } from '../adapters/aerodromeV2.js'
import { aeroSlipstreamPoolId } from '../adapters/aeroSlipstream.js'
import { aeroV2PoolId } from '../adapters/aeroV2.js'
import { uniswapV3PoolId } from '../adapters/uniswapV3.js'
import { computePoolId, uniswapV4PoolId } from '../adapters/uniswapV4.js'
import { floorDiv } from '../internal/ticks.js'
import {
  SYNTHETIC_OWNERS,
  type SyntheticActivity,
  type SyntheticConcentratedPool,
  type SyntheticConcentratedVariant,
  type SyntheticLpHolding,
  type SyntheticPosition,
  type SyntheticV2Pool,
  type SyntheticWorld,
  syntheticGaugeAddress,
  syntheticPoolAddress,
  ZERO_ADDRESS,
} from './syntheticTypes.js'

export type WorldClock = Omit<SyntheticWorld, 'pools'>

export interface PositionTemplate {
  /** Tick offsets from the base price's tick aligned down to tickSpacing (multiples of it). */
  lower: number
  upper: number
  liquidity: bigint
  /** Index into SYNTHETIC_OWNERS. */
  owner: number
  /** Staked in the pool's CLGauge (Slipstream, Aerodrome or Aero): the NFPM reports the gauge. */
  staked?: boolean
  /** Liquidity follows this scripted market maker instead of the pool's cycle and noise. */
  scripted?: 'slipstreamMarketMaker'
}

/** LP-token share of one synthetic owner in a v2 pool, in percent of the base supply. */
export interface LpHolderTemplate {
  /** Index into SYNTHETIC_OWNERS. */
  owner: number
  walletPct: number
  stakedPct: number
  /** Holdings follow this scripted market maker in the time-varying world. */
  scripted?: 'aeroMarketMaker'
}

/** One hour of a concentrated pool in the time-varying world. */
export interface ConcentratedFactors {
  /** Multiplier of `spec.price` (token1 per token0). */
  price: number
  /** Liquidity multiplier per template (missing entries: 1). */
  liquidity: readonly number[]
  /** The hour's LP fee in pips, for a pool whose fee moves (default: `spec.feePips`). */
  feePips?: number
}

/** One hour of a v2 pool (Aerodrome or Aero) in the time-varying world. */
export interface V2Factors {
  /** Multiplier of the token0 price in token1 (reserve1 / reserve0 of a constant-product pool). */
  price: number
  /** Multiplier of the LP supply held by everyone but the templated holders. */
  others: number
  /** The templated holders at this hour (percent of the base supply). */
  holders: readonly LpHolderTemplate[]
}

export const IDENTITY_CONCENTRATED: ConcentratedFactors = Object.freeze({
  price: 1,
  liquidity: Object.freeze([]),
})

/** `value × factor` with 1e-9 resolution (a factor of exactly 1 returns `value`). */
export function scaleBigint(value: bigint, factor: number): bigint {
  if (factor === 1) return value
  if (!Number.isFinite(factor) || factor < 0) throw new RangeError(`bad scale factor ${factor}`)
  return (value * BigInt(Math.round(factor * 1e9))) / 1_000_000_000n
}

export interface ConcentratedSpec {
  label: string
  variant: SyntheticConcentratedVariant
  token0: TokenInfo
  token1: TokenInfo
  feePips: number
  tickSpacing: number
  /** token1 per token0, human. */
  price: number
  createdOffset: bigint
  templates: PositionTemplate[]
  firstTokenId: bigint
  activity: SyntheticActivity
}

export interface V2Spec {
  label: string
  /** Default `aerodrome-v2`; an `aero-v2` pool comes from the volatile or the stable factory. */
  dex?: 'aerodrome-v2' | 'aero-v2'
  token0: TokenInfo
  token1: TokenInfo
  stable: boolean
  feeBps: bigint
  reserve0: bigint
  reserve1: bigint
  createdOffset: bigint
  activity: SyntheticActivity
  holders: LpHolderTemplate[]
}

/** Pool creation is measured from the anchor, so every epoch of a world agrees on it. */
function anchorBlock(world: WorldClock): bigint {
  return world.timeline?.anchorBlock ?? world.latestBlock
}

function clampCreated(latest: bigint, offset: bigint): bigint {
  const created = latest - offset
  return created > 1n ? created : 1n
}

export function positionAmounts(
  state: Pick<ConcentratedState, 'tick' | 'sqrtPriceX96'>,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const lower = getSqrtRatioAtTick(tickLower)
  const upper = getSqrtRatioAtTick(tickUpper)
  if (state.tick < tickLower)
    return { amount0: getAmount0Delta(lower, upper, liquidity, false), amount1: 0n }
  if (state.tick >= tickUpper)
    return { amount0: 0n, amount1: getAmount1Delta(lower, upper, liquidity, false) }
  return {
    amount0: getAmount0Delta(state.sqrtPriceX96, upper, liquidity, false),
    amount1: getAmount1Delta(lower, state.sqrtPriceX96, liquidity, false),
  }
}

export interface RawPosition {
  tickLower: number
  tickUpper: number
  liquidity: bigint
}

/** Price, tick and positions of a concentrated pool under `factors` (ranges never move). */
export function concentratedLayout(
  spec: ConcentratedSpec,
  factors: ConcentratedFactors = IDENTITY_CONCENTRATED,
): { sqrtPriceX96: bigint; tick: number; positions: RawPosition[] } {
  const { decimals: d0 } = spec.token0
  const { decimals: d1 } = spec.token1
  const baseSqrt = priceToSqrtPriceX96(spec.price, d0, d1)
  const aligned = floorDiv(getTickAtSqrtRatio(baseSqrt), spec.tickSpacing) * spec.tickSpacing
  const sqrtPriceX96 =
    factors.price === 1 ? baseSqrt : priceToSqrtPriceX96(spec.price * factors.price, d0, d1)
  const positions = spec.templates.map((t, i) => ({
    tickLower: aligned + t.lower,
    tickUpper: aligned + t.upper,
    liquidity: scaleBigint(t.liquidity, factors.liquidity[i] ?? 1),
  }))
  return { sqrtPriceX96, tick: getTickAtSqrtRatio(sqrtPriceX96), positions }
}

export function buildConcentrated(
  spec: ConcentratedSpec,
  world: WorldClock,
  factors: ConcentratedFactors = IDENTITY_CONCENTRATED,
): SyntheticConcentratedPool {
  const { sqrtPriceX96, tick, positions: raw } = concentratedLayout(spec, factors)
  const feePips = factors.feePips ?? spec.feePips
  const state = buildConcentratedState({
    positions: raw,
    tick,
    sqrtPriceX96,
    feePips,
    tickSpacing: spec.tickSpacing,
    blockNumber: world.latestBlock,
    timestamp: world.latestTimestamp,
  })
  const slipstream = spec.variant === 'slipstream' || spec.variant === 'aero-slipstream'
  const gauge = slipstream ? syntheticGaugeAddress(spec.label) : null
  let reserve0 = 0n
  let reserve1 = 0n
  const positions: SyntheticPosition[] = raw.map((p, i) => {
    const amounts = positionAmounts(state, p.tickLower, p.tickUpper, p.liquidity)
    reserve0 += amounts.amount0
    reserve1 += amounts.amount1
    const template = spec.templates[i]
    const owner = SYNTHETIC_OWNERS[template?.owner ?? 0] ?? SYNTHETIC_OWNERS[0]!
    if (template?.staked && gauge === null)
      throw new Error(`synthetic ${spec.label}: only Slipstream positions can be staked`)
    return {
      ...p,
      ...amounts,
      owner,
      holder: template?.staked && gauge !== null ? gauge : owner,
      tokenId: spec.firstTokenId + BigInt(i),
    }
  })
  const createdAtBlock = clampCreated(anchorBlock(world), spec.createdOffset)
  const common = {
    kind: 'concentrated' as const,
    token0: spec.token0,
    token1: spec.token1,
    feePips,
    tickSpacing: spec.tickSpacing,
    stable: false,
    createdAtBlock,
  }
  let meta: PoolMeta
  if (spec.variant === 'v4') {
    const poolId = computePoolId({
      currency0: spec.token0.address,
      currency1: spec.token1.address,
      fee: spec.feePips,
      tickSpacing: spec.tickSpacing,
      hooks: ZERO_ADDRESS,
    })
    meta = {
      ...common,
      id: uniswapV4PoolId(poolId),
      dex: 'uniswap-v4',
      address: null,
      poolId,
      hooks: ZERO_ADDRESS,
    }
  } else {
    const address = syntheticPoolAddress(spec.label)
    const keyed = { ...common, address, poolId: null, hooks: null }
    meta =
      spec.variant === 'v3'
        ? { ...keyed, id: uniswapV3PoolId(address), dex: 'uniswap-v3' }
        : spec.variant === 'slipstream'
          ? { ...keyed, id: slipstreamPoolId(address), dex: 'aerodrome-slipstream' }
          : { ...keyed, id: aeroSlipstreamPoolId(address), dex: 'aero-slipstream' }
  }
  return {
    kind: 'concentrated',
    variant: spec.variant,
    meta,
    state,
    positions,
    reserve0,
    reserve1,
    gauge,
    ...spec.activity,
  }
}

function lpHoldings(
  templates: readonly LpHolderTemplate[],
  totalSupply: bigint,
): SyntheticLpHolding[] {
  const pct = (p: number) => (totalSupply * BigInt(p)) / 100n
  return templates.map((t) => ({
    owner: SYNTHETIC_OWNERS[t.owner] ?? SYNTHETIC_OWNERS[0]!,
    balance: pct(t.walletPct),
    staked: pct(t.stakedPct),
  }))
}

const PPM = 1_000_000n

function holderPpm(holders: readonly LpHolderTemplate[]): bigint {
  return holders.reduce((n, h) => n + BigInt(Math.round((h.walletPct + h.stakedPct) * 10_000)), 0n)
}

export function buildV2(
  spec: V2Spec,
  world: WorldClock,
  factors: V2Factors = { price: 1, others: 1, holders: spec.holders },
): SyntheticV2Pool {
  const address = syntheticPoolAddress(spec.label)
  const dex = spec.dex ?? 'aerodrome-v2'
  const meta: PoolMeta = {
    id: dex === 'aero-v2' ? aeroV2PoolId(address) : aerodromeV2PoolId(address),
    dex,
    kind: spec.stable ? 'stable-swap' : 'constant-product',
    address,
    poolId: null,
    token0: spec.token0,
    token1: spec.token1,
    feePips: Number(spec.feeBps) * 100,
    tickSpacing: null,
    stable: spec.stable,
    hooks: null,
    createdAtBlock: clampCreated(anchorBlock(world), spec.createdOffset),
  }
  // The base supply is √(reserve0·reserve1); the other holders' share scales with `others`, the
  // templated holders hold what `factors.holders` says, and reserves follow the total supply.
  const baseSupply = sqrtBigint(spec.reserve0 * spec.reserve1)
  const othersPpm = PPM - holderPpm(spec.holders)
  const totalPpm =
    (factors.others === 1 ? othersPpm : BigInt(Math.round(Number(othersPpm) * factors.others))) +
    holderPpm(factors.holders)
  const sqrtPrice = Math.sqrt(factors.price)
  return {
    kind: 'v2',
    meta,
    reserve0: scaleBigint((spec.reserve0 * totalPpm) / PPM, 1 / sqrtPrice),
    reserve1: scaleBigint((spec.reserve1 * totalPpm) / PPM, sqrtPrice),
    feeBps: spec.feeBps,
    lpTotalSupply: (baseSupply * totalPpm) / PPM,
    gauge: syntheticGaugeAddress(spec.label),
    lpHoldings: lpHoldings(factors.holders, baseSupply),
    ...spec.activity,
  }
}
