/**
 * Registers state and position answers for one synthetic concentrated pool: slot0/liquidity/fee/
 * tickSpacing (or StateView equivalents), tick-bitmap words, `ticks()` per initialised tick, token
 * balances, NFPM/PositionManager position reads and the logs that lead to them; for the Aero
 * Slipstream pool also its factory and swap-hook reads (syntheticAero.ts).
 */
import type { Address } from '@depthwatch/core'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import { aeroNFPMAbi } from '../abi/aeroNFPM.js'
import { erc20Abi } from '../abi/erc20.js'
import { nonfungiblePositionManagerAbi } from '../abi/nonfungiblePositionManager.js'
import { slipstreamNFPMAbi } from '../abi/slipstreamNFPM.js'
import { uniswapV3PoolAbi } from '../abi/uniswapV3Pool.js'
import type { ChainAddresses } from '../addresses.js'
import { bitmapPosition, wordOfTick } from '../internal/ticks.js'
import type { Fixture, FixtureLog } from '../transport/fixture.js'
import { addLogs, type BlockRef, makeLog, registerCall } from './builders.js'
import { registerAeroSlipstreamHook } from './syntheticAero.js'
import { registerSlipstreamGauge } from './syntheticGauges.js'
import {
  AERO_SLIPSTREAM_FACTORY_INDEX,
  SLIPSTREAM_INITIAL_FACTORY_INDEX,
  type SyntheticConcentratedPool,
  type SyntheticWorld,
  ZERO_ADDRESS,
} from './syntheticTypes.js'
import { registerV4Positions, registerV4State } from './syntheticV4.js'

/** Words registered on each side of the current word (plenty for any band the CLI asks for). */
const WORD_MARGIN = 16

/** Bitmap per word for the pool's initialised ticks, padded with zero words around them. */
export function bitmapWords(pool: SyntheticConcentratedPool): Map<number, bigint> {
  const ts = pool.state.tickSpacing
  const words = new Map<number, bigint>()
  for (const t of pool.state.ticks) {
    const { word, bit } = bitmapPosition(t.index, ts)
    words.set(word, (words.get(word) ?? 0n) | (1n << BigInt(bit)))
  }
  const current = wordOfTick(pool.state.tick, ts)
  const lo = Math.min(current - WORD_MARGIN, ...words.keys())
  const hi = Math.max(current + WORD_MARGIN, ...words.keys())
  for (let w = lo; w <= hi; w++) if (!words.has(w)) words.set(w, 0n)
  return words
}

/** Block of the i-th position's mint, inside the swap window so `readPositions` finds it. */
export function positionBlock(world: SyntheticWorld, i: number): bigint {
  const start = world.latestBlock - world.swapWindowBlocks + 100n
  return start + BigInt(i) * 500n
}

/** Block of the i-th position's gauge deposit (its NFT transfer to the CLGauge). */
export function stakeBlock(world: SyntheticWorld, i: number): bigint {
  return positionBlock(world, i) + 250n
}

function registerBalances(
  fixture: Fixture,
  pool: SyntheticConcentratedPool,
  blocks: BlockRef[],
): void {
  const address = pool.meta.address as Address
  registerCall(fixture, {
    to: pool.meta.token0.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
    result: pool.reserve0,
    blocks,
  })
  registerCall(fixture, {
    to: pool.meta.token1.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
    result: pool.reserve1,
    blocks,
  })
}

type PoolAbi = typeof uniswapV3PoolAbi | typeof aerodromeCLPoolAbi

/** Reads common to v3 and Slipstream pools; `slot0` / `ticks` shapes differ and are passed in. */
function registerPoolReads(
  fixture: Fixture,
  pool: SyntheticConcentratedPool,
  abi: PoolAbi,
  slot0: readonly unknown[],
  tickResult: (gross: bigint, net: bigint) => readonly unknown[],
  blocks: BlockRef[],
): void {
  const to = pool.meta.address as Address
  const st = pool.state
  registerCall(fixture, { to, abi, functionName: 'slot0', result: slot0, blocks })
  registerCall(fixture, { to, abi, functionName: 'liquidity', result: st.liquidity, blocks })
  registerCall(fixture, { to, abi, functionName: 'fee', result: st.feePips, blocks })
  registerCall(fixture, { to, abi, functionName: 'tickSpacing', result: st.tickSpacing, blocks })
  registerCall(fixture, {
    to,
    abi,
    functionName: 'token0',
    result: pool.meta.token0.address,
    blocks,
  })
  registerCall(fixture, {
    to,
    abi,
    functionName: 'token1',
    result: pool.meta.token1.address,
    blocks,
  })
  for (const [word, bitmap] of bitmapWords(pool))
    registerCall(fixture, {
      to,
      abi,
      functionName: 'tickBitmap',
      args: [word],
      result: bitmap,
      blocks,
    })
  for (const t of st.ticks)
    registerCall(fixture, {
      to,
      abi,
      functionName: 'ticks',
      args: [t.index],
      result: tickResult(t.liquidityGross, t.liquidityNet),
      blocks,
    })
  registerBalances(fixture, pool, blocks)
}

function registerV3State(
  fixture: Fixture,
  pool: SyntheticConcentratedPool,
  blocks: BlockRef[],
): void {
  const st = pool.state
  registerPoolReads(
    fixture,
    pool,
    uniswapV3PoolAbi,
    [st.sqrtPriceX96, st.tick, 0, 1, 1, 0, true],
    (gross, net) => [gross, net, 0n, 0n, 0n, 0n, 0, true],
    blocks,
  )
}

function registerSlipstreamState(
  fixture: Fixture,
  pool: SyntheticConcentratedPool,
  blocks: BlockRef[],
): void {
  const st = pool.state
  registerPoolReads(
    fixture,
    pool,
    aerodromeCLPoolAbi,
    [st.sqrtPriceX96, st.tick, 0, 1, 1, true],
    // Slipstream `ticks()`: stakedLiquidityNet (3rd) and rewardGrowthOutsideX128 (6th) are extra.
    (gross, net) => [gross, net, net / 2n, 0n, 0n, 0n, 0n, 0n, 0, true],
    blocks,
  )
  registerCall(fixture, {
    to: pool.meta.address as Address,
    abi: aerodromeCLPoolAbi,
    functionName: 'stakedLiquidity',
    result: st.liquidity / 2n,
    blocks,
  })
}

/**
 * NFPM reads of every position (latest liquidity and holder) and, in the static world, the mint
 * logs that lead to them (the time-varying world's position logs come from syntheticHistory.ts).
 */
function registerNfpmPositions(
  fixture: Fixture,
  world: SyntheticWorld,
  pool: SyntheticConcentratedPool,
  nfpm: Address,
  abi: typeof nonfungiblePositionManagerAbi | typeof slipstreamNFPMAbi | typeof aeroNFPMAbi,
  keyValue: number,
): void {
  const logs: FixtureLog[] = []
  const withLogs = world.timeline === null
  pool.positions.forEach((p, i) => {
    registerCall(fixture, {
      to: nfpm,
      abi,
      functionName: 'positions',
      args: [p.tokenId],
      result: [
        0n,
        ZERO_ADDRESS,
        pool.meta.token0.address,
        pool.meta.token1.address,
        keyValue,
        p.tickLower,
        p.tickUpper,
        p.liquidity,
        0n,
        0n,
        0n,
        0n,
      ],
    })
    // A staked NFT belongs to the CLGauge: `ownerOf` reports the gauge, not the depositor.
    registerCall(fixture, {
      to: nfpm,
      abi,
      functionName: 'ownerOf',
      args: [p.tokenId],
      result: p.holder,
    })
    if (!withLogs) return
    const blockNumber = positionBlock(world, i)
    logs.push(
      makeLog({
        address: nfpm,
        abi,
        eventName: 'Transfer',
        args: { from: ZERO_ADDRESS, to: p.owner, tokenId: p.tokenId },
        blockNumber,
        logIndex: 0,
      }),
      makeLog({
        address: nfpm,
        abi,
        eventName: 'IncreaseLiquidity',
        // The ticks are read by the Aero NFPM's 6-field event only.
        args: {
          tokenId: p.tokenId,
          liquidity: p.liquidity,
          amount0: p.amount0,
          amount1: p.amount1,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
        },
        blockNumber,
        logIndex: 1,
      }),
    )
    if (p.holder !== p.owner)
      logs.push(
        makeLog({
          address: nfpm,
          abi,
          eventName: 'Transfer',
          args: { from: p.owner, to: p.holder, tokenId: p.tokenId },
          blockNumber: stakeBlock(world, i),
          logIndex: 0,
        }),
      )
  })
  addLogs(fixture, logs)
}

export function registerConcentratedPool(
  fixture: Fixture,
  world: SyntheticWorld,
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
): void {
  const blocks: BlockRef[] = ['latest', world.latestBlock]
  switch (pool.variant) {
    case 'v3':
      registerV3State(fixture, pool, blocks)
      registerNfpmPositions(
        fixture,
        world,
        pool,
        addresses.uniswapV3.positionManager,
        nonfungiblePositionManagerAbi,
        pool.meta.feePips,
      )
      return
    case 'slipstream': {
      registerSlipstreamState(fixture, pool, blocks)
      const ts = pool.meta.tickSpacing ?? 0
      // Only the "initial" deployment knows this pool; the other factories answer address(0).
      addresses.aerodromeSlipstream.forEach((d, i) => {
        registerCall(fixture, {
          to: d.factory,
          abi: aerodromeCLFactoryAbi,
          functionName: 'getPool',
          args: [pool.meta.token0.address, pool.meta.token1.address, ts],
          result:
            i === SLIPSTREAM_INITIAL_FACTORY_INDEX ? (pool.meta.address as Address) : ZERO_ADDRESS,
        })
        registerCall(fixture, {
          to: d.factory,
          abi: aerodromeCLFactoryAbi,
          functionName: 'tickSpacingToFee',
          args: [ts],
          result: pool.meta.feePips,
        })
      })
      const initial = addresses.aerodromeSlipstream[SLIPSTREAM_INITIAL_FACTORY_INDEX]
      if (initial)
        registerNfpmPositions(fixture, world, pool, initial.positionManager, slipstreamNFPMAbi, ts)
      registerSlipstreamGauge(fixture, world, pool, addresses)
      return
    }
    case 'aero-slipstream': {
      registerSlipstreamState(fixture, pool, blocks)
      registerAeroSlipstreamHook(fixture, pool, addresses, blocks)
      const aero = addresses.aeroSlipstream[AERO_SLIPSTREAM_FACTORY_INDEX]
      if (aero)
        registerNfpmPositions(
          fixture,
          world,
          pool,
          aero.positionManager,
          aeroNFPMAbi,
          pool.meta.tickSpacing ?? 0,
        )
      registerSlipstreamGauge(fixture, world, pool, addresses)
      return
    }
    case 'v4':
      registerV4State(fixture, pool, addresses, blocks)
      registerV4Positions(fixture, world, pool, addresses)
      return
  }
}
