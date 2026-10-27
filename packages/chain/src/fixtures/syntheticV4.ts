/**
 * Uniswap v4 part of the synthetic fixture: StateView answers for one pool and PositionManager
 * NFTs reached through PoolManager `ModifyLiquidity` logs (`sender == PositionManager`,
 * `salt == bytes32(tokenId)`).
 */
import type { Hex } from '@depthwatch/core'
import { numberToHex, pad } from 'viem'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import { v4PositionManagerAbi } from '../abi/v4PositionManager.js'
import { v4StateViewAbi } from '../abi/v4StateView.js'
import type { ChainAddresses } from '../addresses.js'
import type { Fixture, FixtureLog } from '../transport/fixture.js'
import { addLogs, type BlockRef, makeLog, registerCall } from './builders.js'
import { bitmapWords, positionBlock } from './syntheticConcentrated.js'
import type { SyntheticConcentratedPool, SyntheticWorld } from './syntheticTypes.js'
import { ZERO_ADDRESS } from './syntheticTypes.js'

/** Packed PositionManager `positionInfo` (upper 200 bits of PoolId | tickUpper | tickLower | 0). */
export function packPositionInfo(poolId: Hex, tickLower: number, tickUpper: number): bigint {
  const poolId25 = BigInt(poolId) >> 56n
  const u24 = (x: number) => BigInt(x & 0xffffff)
  return (poolId25 << 56n) | (u24(tickUpper) << 32n) | (u24(tickLower) << 8n)
}

export function registerV4State(
  fixture: Fixture,
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
  blocks: BlockRef[],
): void {
  const to = addresses.uniswapV4.stateView
  const st = pool.state
  const poolId = pool.meta.poolId as Hex
  const abi = v4StateViewAbi
  registerCall(fixture, {
    to,
    abi,
    functionName: 'getSlot0',
    args: [poolId],
    result: [st.sqrtPriceX96, st.tick, 0, st.feePips],
    blocks,
  })
  registerCall(fixture, {
    to,
    abi,
    functionName: 'getLiquidity',
    args: [poolId],
    result: st.liquidity,
    blocks,
  })
  for (const [word, bitmap] of bitmapWords(pool))
    registerCall(fixture, {
      to,
      abi,
      functionName: 'getTickBitmap',
      args: [poolId, word],
      result: bitmap,
      blocks,
    })
  for (const t of st.ticks)
    registerCall(fixture, {
      to,
      abi,
      functionName: 'getTickInfo',
      args: [poolId, t.index],
      result: [t.liquidityGross, t.liquidityNet, 0n, 0n],
      blocks,
    })
}

export function registerV4Positions(
  fixture: Fixture,
  world: SyntheticWorld,
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
): void {
  const posm = addresses.uniswapV4.positionManager
  const poolId = pool.meta.poolId as Hex
  const key = {
    currency0: pool.meta.token0.address,
    currency1: pool.meta.token1.address,
    fee: pool.meta.feePips,
    tickSpacing: pool.meta.tickSpacing ?? 0,
    hooks: ZERO_ADDRESS,
  }
  const logs: FixtureLog[] = []
  pool.positions.forEach((p, i) => {
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'ownerOf',
      args: [p.tokenId],
      result: p.owner,
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPoolAndPositionInfo',
      args: [p.tokenId],
      result: [key, packPositionInfo(poolId, p.tickLower, p.tickUpper)],
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPositionLiquidity',
      args: [p.tokenId],
      result: p.liquidity,
    })
    // The time-varying world's ModifyLiquidity logs come from syntheticHistory.ts.
    if (world.timeline !== null) return
    logs.push(
      makeLog({
        address: addresses.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'ModifyLiquidity',
        args: {
          id: poolId,
          sender: posm,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          liquidityDelta: p.liquidity,
          salt: pad(numberToHex(p.tokenId), { size: 32 }),
        },
        blockNumber: positionBlock(world, i),
        logIndex: 0,
      }),
    )
  })
  addLogs(fixture, logs)
}
