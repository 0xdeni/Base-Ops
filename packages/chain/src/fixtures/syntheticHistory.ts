/**
 * Logs of the time-varying world, built once per (addresses, seed, anchor) and shared by every
 * epoch fixture of that world (docs/design/web-v2.md §3):
 *
 * - LP positions of the concentrated pools are minted inside the hour that starts
 *   `SYNTHETIC_HISTORY.mintAgeSeconds` before the anchor (before every epoch), then rebalanced on
 *   the first block of every later hour whose liquidity differs from the previous hour's
 *   (NFPM `IncreaseLiquidity` / `DecreaseLiquidity`, PoolManager `ModifyLiquidity` for v4). The
 *   rebalances add up exactly to each hour's liquidity, so `readPositions` over any block range
 *   sees every position whose liquidity changed in it.
 * - Swaps are built per pool and hour from `plannedSwaps` at that hour's prices.
 *
 * A fixture takes what lies at or before its epoch block, so consecutive epochs read like one
 * chain. The cache keeps a few worlds per address book; it never changes what a fixture holds.
 */
import type { Address, Hex } from '@depthwatch/core'
import { numberToHex, pad } from 'viem'
import { nonfungiblePositionManagerAbi } from '../abi/nonfungiblePositionManager.js'
import { slipstreamNFPMAbi } from '../abi/slipstreamNFPM.js'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import type { ChainAddresses } from '../addresses.js'
import type { FixtureLog } from '../transport/fixture.js'
import { makeLog } from './builders.js'
import { type ConcentratedSpec, concentratedLayout, positionAmounts } from './syntheticBuild.js'
import {
  plannedSwaps,
  type SwapPriceState,
  swapKind,
  swapLog,
  swapWindowHours,
  tokenUsdAt,
} from './syntheticSwaps.js'
import { blockAtOrAfter, HOUR_SECONDS, hourOf, SYNTHETIC_HISTORY } from './syntheticTime.js'
import {
  SLIPSTREAM_INITIAL_FACTORY_INDEX,
  type SyntheticConcentratedPool,
  type SyntheticTimeline,
  type SyntheticWorld,
  ZERO_ADDRESS,
} from './syntheticTypes.js'
import { concentratedFactorsAt, SYNTHETIC_POOL_SPECS } from './syntheticWorld.js'

interface BlockLogs {
  block: bigint
  logs: FixtureLog[]
}

interface TimelineLogs {
  /** Per pool index: position logs grouped by block, ascending. */
  positions: Map<number, BlockLogs[]>
  /** Per `${poolIndex}:${hour}`: that hour's swap logs, ascending. */
  swaps: Map<string, FixtureLog[]>
}

const WORLDS_PER_ADDRESS_BOOK = 4
const caches = new WeakMap<ChainAddresses, Map<string, TimelineLogs>>()

function timelineLogs(addresses: ChainAddresses, timeline: SyntheticTimeline): TimelineLogs {
  let worlds = caches.get(addresses)
  if (worlds === undefined) {
    worlds = new Map()
    caches.set(addresses, worlds)
  }
  const key = `${timeline.seed}:${timeline.anchorBlock}:${timeline.anchorTimestamp}`
  let logs = worlds.get(key)
  if (logs === undefined) {
    if (worlds.size >= WORLDS_PER_ADDRESS_BOOK) {
      const oldest = worlds.keys().next().value
      if (oldest !== undefined) worlds.delete(oldest)
    }
    logs = { positions: new Map(), swaps: new Map() }
    worlds.set(key, logs)
  }
  return logs
}

function requireTimeline(world: SyntheticWorld): SyntheticTimeline {
  if (world.timeline === null) throw new Error('synthetic: not a time-varying world')
  return world.timeline
}

function concentratedSpec(poolIndex: number): ConcentratedSpec {
  const entry = SYNTHETIC_POOL_SPECS[poolIndex]
  if (entry?.kind !== 'concentrated')
    throw new Error(`synthetic: pool ${poolIndex} has no positions`)
  return entry.spec
}

/** The price state of a concentrated pool during `hour` (active liquidity: in-range positions). */
function hourPriceState(
  timeline: SyntheticTimeline,
  poolIndex: number,
  spec: ConcentratedSpec,
  hour: number,
): SwapPriceState & { positions: ReturnType<typeof concentratedLayout>['positions'] } {
  const layout = concentratedLayout(spec, concentratedFactorsAt(spec, poolIndex, timeline, hour))
  let liquidity = 0n
  for (const p of layout.positions)
    if (p.tickLower <= layout.tick && layout.tick < p.tickUpper) liquidity += p.liquidity
  return { ...layout, liquidity }
}

interface PositionLogTarget {
  pool: SyntheticConcentratedPool
  /** The NFPM (v3 / Slipstream) or null for v4 (PoolManager `ModifyLiquidity`). */
  nfpm: {
    address: Address
    abi: typeof nonfungiblePositionManagerAbi | typeof slipstreamNFPMAbi
  } | null
  addresses: ChainAddresses
}

function liquidityLog(
  target: PositionLogTarget,
  i: number,
  delta: bigint,
  amounts: { amount0: bigint; amount1: bigint },
  blockNumber: bigint,
  logIndex: number,
): FixtureLog {
  const { pool, nfpm, addresses } = target
  const p = pool.positions[i]
  if (p === undefined) throw new Error(`synthetic ${pool.meta.id}: no position ${i}`)
  if (nfpm === null)
    return makeLog({
      address: addresses.uniswapV4.poolManager,
      abi: v4PoolManagerAbi,
      eventName: 'ModifyLiquidity',
      args: {
        id: pool.meta.poolId as Hex,
        sender: addresses.uniswapV4.positionManager,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidityDelta: delta,
        salt: pad(numberToHex(p.tokenId), { size: 32 }),
      },
      blockNumber,
      logIndex,
    })
  const liquidity = delta < 0n ? -delta : delta
  return makeLog({
    address: nfpm.address,
    abi: nfpm.abi,
    eventName: delta < 0n ? 'DecreaseLiquidity' : 'IncreaseLiquidity',
    args: { tokenId: p.tokenId, liquidity, ...amounts },
    blockNumber,
    logIndex,
  })
}

function nfpmOf(
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
): PositionLogTarget['nfpm'] {
  if (pool.variant === 'v4') return null
  if (pool.variant === 'v3')
    return { address: addresses.uniswapV3.positionManager, abi: nonfungiblePositionManagerAbi }
  const initial = addresses.aerodromeSlipstream[SLIPSTREAM_INITIAL_FACTORY_INDEX]
  if (initial === undefined) throw new Error('synthetic: no Slipstream deployment configured')
  return { address: initial.positionManager, abi: slipstreamNFPMAbi }
}

/** Mints, then one block of rebalances per hour up to the anchor's hour. */
function buildPositionLogs(
  timeline: SyntheticTimeline,
  poolIndex: number,
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
): BlockLogs[] {
  const spec = concentratedSpec(poolIndex)
  const target: PositionLogTarget = { pool, nfpm: nfpmOf(pool, addresses), addresses }
  const mintHour = hourOf(timeline.anchorTimestamp - SYNTHETIC_HISTORY.mintAgeSeconds)
  const mintStart = blockAtOrAfter(timeline, mintHour * HOUR_SECONDS)
  const minted = hourPriceState(timeline, poolIndex, spec, mintHour)
  const out: BlockLogs[] = []
  pool.positions.forEach((p, i) => {
    const block = mintStart + 1n + BigInt(poolIndex * 100 + i * 4)
    const liquidity = minted.positions[i]?.liquidity ?? 0n
    const amounts = positionAmounts(minted, p.tickLower, p.tickUpper, liquidity)
    const mint = liquidityLog(target, i, liquidity, amounts, block, target.nfpm === null ? 0 : 1)
    if (target.nfpm === null) {
      out.push({ block, logs: [mint] })
      return
    }
    const { address, abi } = target.nfpm
    const transfer = makeLog({
      address,
      abi,
      eventName: 'Transfer',
      args: { from: ZERO_ADDRESS, to: p.owner, tokenId: p.tokenId },
      blockNumber: block,
      logIndex: 0,
    })
    out.push({ block, logs: [transfer, mint] })
    if (p.holder !== p.owner)
      out.push({
        block: block + 1n,
        logs: [
          makeLog({
            address,
            abi,
            eventName: 'Transfer',
            args: { from: p.owner, to: p.holder, tokenId: p.tokenId },
            blockNumber: block + 1n,
            logIndex: 0,
          }),
        ],
      })
  })
  let previous = minted.positions.map((p) => p.liquidity)
  for (let hour = mintHour + 1; hour <= hourOf(timeline.anchorTimestamp); hour++) {
    const state = hourPriceState(timeline, poolIndex, spec, hour)
    const block = blockAtOrAfter(timeline, hour * HOUR_SECONDS)
    const logs: FixtureLog[] = []
    state.positions.forEach((current, i) => {
      const delta = current.liquidity - (previous[i] ?? 0n)
      if (delta === 0n) return
      const size = delta < 0n ? -delta : delta
      const amounts = positionAmounts(state, current.tickLower, current.tickUpper, size)
      // Unique per (manager, block): two pools share the Uniswap v3 NFPM.
      logs.push(liquidityLog(target, i, delta, amounts, block, poolIndex * 64 + i))
    })
    if (logs.length > 0) out.push({ block, logs })
    previous = state.positions.map((p) => p.liquidity)
  }
  return out
}

/** Position logs of concentrated pool `poolIndex` at or before the world's epoch block. */
export function positionHistoryLogs(
  world: SyntheticWorld,
  poolIndex: number,
  addresses: ChainAddresses,
): FixtureLog[] {
  const timeline = requireTimeline(world)
  const pool = world.pools[poolIndex]
  if (pool?.kind !== 'concentrated') return []
  const cache = timelineLogs(addresses, timeline)
  let blocks = cache.positions.get(poolIndex)
  if (blocks === undefined) {
    blocks = buildPositionLogs(timeline, poolIndex, pool, addresses)
    cache.positions.set(poolIndex, blocks)
  }
  const out: FixtureLog[] = []
  for (const entry of blocks) {
    if (entry.block > timeline.epochBlock) break
    out.push(...entry.logs)
  }
  return out
}

/** Swap logs of pool `poolIndex` in the 24 h before the world's epoch (up to its block). */
export function swapHistoryLogs(
  world: SyntheticWorld,
  poolIndex: number,
  addresses: ChainAddresses,
): FixtureLog[] {
  const timeline = requireTimeline(world)
  const pool = world.pools[poolIndex]
  const entry = SYNTHETIC_POOL_SPECS[poolIndex]
  if (pool === undefined || entry === undefined) return []
  const cache = timelineLogs(addresses, timeline)
  const out: FixtureLog[] = []
  for (const hour of swapWindowHours(timeline)) {
    const key = `${poolIndex}:${hour}`
    let logs = cache.swaps.get(key)
    if (logs === undefined) {
      const price =
        entry.kind === 'concentrated' ? hourPriceState(timeline, poolIndex, entry.spec, hour) : null
      const usd = tokenUsdAt(timeline, entry.spec, hour)
      logs = plannedSwaps(timeline, poolIndex, entry.spec.activity, hour).map((swap) =>
        swapLog(pool.meta, swapKind(pool), addresses, {
          usd: swap.usd,
          zeroForOne: swap.zeroForOne,
          ...usd,
          blockNumber: swap.blockNumber,
          logIndex: swap.index,
          txIndex: swap.index,
          price,
        }),
      )
      cache.swaps.set(key, logs)
    }
    for (const log of logs) if (BigInt(log.blockNumber) <= timeline.epochBlock) out.push(log)
  }
  return out
}
