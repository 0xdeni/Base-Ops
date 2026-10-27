import type { Hex } from '@depthwatch/core'
import { getAddress, numberToHex, pad } from 'viem'
import { describe, expect, it } from 'vitest'
import { aerodromeCLFactoryAbi } from './abi/aerodromeCLFactory.js'
import { nonfungiblePositionManagerAbi } from './abi/nonfungiblePositionManager.js'
import { slipstreamNFPMAbi } from './abi/slipstreamNFPM.js'
import { v4PoolManagerAbi } from './abi/v4PoolManager.js'
import { v4PositionManagerAbi } from './abi/v4PositionManager.js'
import { v4StateViewAbi } from './abi/v4StateView.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { addLogs, makeLog, registerCall, registerRevert } from './fixtures/builders.js'
import { packPositionInfo } from './fixtures/syntheticV4.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import {
  ALICE,
  addr,
  BOB,
  CAROL,
  countingTransport,
  newFixture,
  poolMeta,
  TOKEN_A,
  TOKEN_B,
  TOKEN_D,
  ZERO,
} from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

function reader(fixture: Fixture, opts: CreateChainReaderOptions = {}) {
  const counts = new Map<string, number>()
  const r = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
    ...opts,
  })
  return { r, counts }
}

const RANGE = { fromBlock: 100n, toBlock: 200n }

describe('readPositions', () => {
  it('uniswap-v3: tokenIds from NFPM logs, positions()/ownerOf() via multicall, filtered to the pool', async () => {
    const fixture = newFixture()
    const nfpm = A.uniswapV3.positionManager
    const abi = nonfungiblePositionManagerAbi
    const pool = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x501),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 3000,
      tickSpacing: 60,
    })
    const other = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x502),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    const inc = (tokenId: bigint, blockNumber: bigint, logIndex = 0) =>
      makeLog({
        address: nfpm,
        abi,
        eventName: 'IncreaseLiquidity',
        args: { tokenId, liquidity: 1n, amount0: 1n, amount1: 1n },
        blockNumber,
        logIndex,
      })
    const dec = (tokenId: bigint, blockNumber: bigint) =>
      makeLog({
        address: nfpm,
        abi,
        eventName: 'DecreaseLiquidity',
        args: { tokenId, liquidity: 1n, amount0: 1n, amount1: 1n },
        blockNumber,
        logIndex: 0,
      })
    const xfer = (tokenId: bigint, from: Hex, to: Hex, blockNumber: bigint) =>
      makeLog({
        address: nfpm,
        abi,
        eventName: 'Transfer',
        args: { from, to, tokenId },
        blockNumber,
        logIndex: 0,
      })
    addLogs(fixture, [
      xfer(1n, ZERO, ALICE, 100n),
      inc(1n, 100n, 1),
      inc(1n, 150n), // same token twice → one position
      dec(2n, 120n),
      xfer(3n, ALICE, BOB, 130n),
      inc(4n, 140n), // other pool (fee 500)
      inc(5n, 160n), // liquidity 0
      dec(6n, 170n), // burned: positions()/ownerOf() revert
      inc(7n, 180n), // other token pair
      inc(8n, 250n), // outside the range: never read
    ])
    const position = (
      tokenId: bigint,
      key: number,
      lower: number,
      upper: number,
      liquidity: bigint,
      owner: Hex,
      token1 = TOKEN_D.address,
    ) => {
      registerCall(fixture, {
        to: nfpm,
        abi,
        functionName: 'positions',
        args: [tokenId],
        result: [0n, ZERO, TOKEN_A.address, token1, key, lower, upper, liquidity, 0n, 0n, 0n, 0n],
      })
      registerCall(fixture, {
        to: nfpm,
        abi,
        functionName: 'ownerOf',
        args: [tokenId],
        result: owner,
      })
    }
    position(1n, 3000, -600, 600, 1_500n, ALICE)
    position(2n, 3000, -120, 120, 500n, BOB)
    position(3n, 3000, 0, 60, 250n, BOB)
    position(4n, 500, -100, 100, 999n, CAROL)
    position(5n, 3000, -60, 60, 0n, ALICE)
    registerRevert(fixture, { to: nfpm, abi, functionName: 'positions', args: [6n] })
    registerRevert(fixture, { to: nfpm, abi, functionName: 'ownerOf', args: [6n] })
    position(7n, 3000, -60, 60, 10n, ALICE, TOKEN_B.address)

    const { r, counts } = reader(fixture)
    expect(await r.readPositions(pool, RANGE)).toEqual([
      { owner: ALICE, tickLower: -600, tickUpper: 600, liquidity: 1_500n, tokenId: 1n },
      { owner: BOB, tickLower: -120, tickUpper: 120, liquidity: 500n, tokenId: 2n },
      { owner: BOB, tickLower: 0, tickUpper: 60, liquidity: 250n, tokenId: 3n },
    ])
    expect(counts.get('eth_getLogs')).toBe(1)
    const calls = counts.get('eth_call')
    // Another pool of the same NFPM and range is served from the cached snapshot.
    expect(await r.readPositions(other, RANGE)).toEqual([
      { owner: CAROL, tickLower: -100, tickUpper: 100, liquidity: 999n, tokenId: 4n },
    ])
    expect(counts.get('eth_getLogs')).toBe(1)
    expect(counts.get('eth_call')).toBe(calls)
    // A different range is fetched again.
    expect(await r.readPositions(pool, { fromBlock: 100n, toBlock: 150n })).toHaveLength(3)
    expect(counts.get('eth_getLogs')).toBe(2)
    expect(await r.readPositions(pool, { fromBlock: 300n, toBlock: 400n })).toEqual([])
  })

  it('aerodrome-v2: no positions, no requests', async () => {
    const { r, counts } = reader(newFixture())
    const pool = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x503),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    expect(await r.readPositions(pool, RANGE)).toEqual([])
    expect(counts.size).toBe(0)
  })

  it('aerodrome-slipstream: only the NFPM of the factory that owns the pool is scanned', async () => {
    const fixture = newFixture()
    const pool = poolMeta({
      dex: 'aerodrome-slipstream',
      address: addr(0x510),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 100,
    })
    A.aerodromeSlipstream.forEach((d, i) => {
      registerCall(fixture, {
        to: d.factory,
        abi: aerodromeCLFactoryAbi,
        functionName: 'getPool',
        args: [TOKEN_A.address, TOKEN_D.address, 100],
        result: i === 1 ? pool.address : ZERO,
      })
    })
    const [d0, d1] = [A.aerodromeSlipstream[0]!, A.aerodromeSlipstream[1]!]
    const abi = slipstreamNFPMAbi
    addLogs(fixture, [
      makeLog({
        address: d1.positionManager,
        abi,
        eventName: 'IncreaseLiquidity',
        args: { tokenId: 10n, liquidity: 1n, amount0: 1n, amount1: 1n },
        blockNumber: 100n,
        logIndex: 0,
      }),
      // Same pair on the other deployment's NFPM: not this pool's, and never read (no fixture entry).
      makeLog({
        address: d0.positionManager,
        abi,
        eventName: 'IncreaseLiquidity',
        args: { tokenId: 11n, liquidity: 1n, amount0: 1n, amount1: 1n },
        blockNumber: 100n,
        logIndex: 0,
      }),
    ])
    registerCall(fixture, {
      to: d1.positionManager,
      abi,
      functionName: 'positions',
      args: [10n],
      result: [0n, ZERO, TOKEN_A.address, TOKEN_D.address, 100, -200, 300, 777n, 0n, 0n, 0n, 0n],
    })
    registerCall(fixture, {
      to: d1.positionManager,
      abi,
      functionName: 'ownerOf',
      args: [10n],
      result: CAROL,
    })
    const { r, counts } = reader(fixture)
    expect(await r.readPositions(pool, RANGE)).toEqual([
      { owner: CAROL, tickLower: -200, tickUpper: 300, liquidity: 777n, tokenId: 10n },
    ])
    expect(counts.get('eth_getLogs')).toBe(1)
  })

  it('uniswap-v4: PositionManager NFTs via ModifyLiquidity salts plus direct positions via StateView', async () => {
    const fixture = newFixture()
    const pool = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    const other = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 3000,
      tickSpacing: 60,
    })
    const posm = A.uniswapV4.positionManager
    const hook = addr(0x4c0)
    const salt = (tokenId: bigint) => pad(numberToHex(tokenId), { size: 32 })
    const modify = (
      id: Hex,
      sender: Hex,
      tickLower: number,
      tickUpper: number,
      liquidityDelta: bigint,
      s: Hex,
      blockNumber: bigint,
    ) =>
      makeLog({
        address: A.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'ModifyLiquidity',
        args: { id, sender, tickLower, tickUpper, liquidityDelta, salt: s },
        blockNumber,
        logIndex: 0,
      })
    addLogs(fixture, [
      modify(pool.poolId as Hex, posm, -100, 100, 1_000n, salt(1n), 100n),
      modify(pool.poolId as Hex, posm, -50, 50, 10n, salt(2n), 110n),
      modify(pool.poolId as Hex, hook, -300, 300, 700n, salt(0n), 120n),
      modify(pool.poolId as Hex, hook, -300, 300, 5n, salt(0n), 125n), // same key → one position
      modify(other.poolId as Hex, posm, -60, 60, 1n, salt(3n), 130n), // other pool: filtered by topic
    ])
    const key = (p: typeof pool) => ({
      currency0: p.token0.address,
      currency1: p.token1.address,
      fee: p.feePips,
      tickSpacing: p.tickSpacing ?? 0,
      hooks: ZERO,
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'ownerOf',
      args: [1n],
      result: ALICE,
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPoolAndPositionInfo',
      args: [1n],
      result: [key(pool), packPositionInfo(pool.poolId as Hex, -100, 100)],
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPositionLiquidity',
      args: [1n],
      result: 1_000n,
    })
    // Token 2 now reports a different pool key (not this pool any more).
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'ownerOf',
      args: [2n],
      result: BOB,
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPoolAndPositionInfo',
      args: [2n],
      result: [key(other), packPositionInfo(other.poolId as Hex, -50, 50)],
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPositionLiquidity',
      args: [2n],
      result: 10n,
    })
    registerCall(fixture, {
      to: A.uniswapV4.stateView,
      abi: v4StateViewAbi,
      functionName: 'getPositionInfo',
      args: [pool.poolId as Hex, hook, -300, 300, salt(0n)],
      result: [705n, 0n, 0n],
    })
    const { r, counts } = reader(fixture)
    expect(await r.readPositions(pool, RANGE)).toEqual([
      { owner: ALICE, tickLower: -100, tickUpper: 100, liquidity: 1_000n, tokenId: 1n },
      { owner: hook, tickLower: -300, tickUpper: 300, liquidity: 705n, tokenId: null },
    ])
    // PoolManager ModifyLiquidity (this pool) + PositionManager Transfer (none here: no reads).
    expect(counts.get('eth_getLogs')).toBe(2)
    expect(counts.get('eth_call')).toBe(1)
  })

  it('uniswap-v4: NFT transfers are seen without ModifyLiquidity; the Transfer scan is shared per range', async () => {
    const fixture = newFixture()
    const pool = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    const other = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 3000,
      tickSpacing: 60,
    })
    const posm = A.uniswapV4.positionManager
    const salt = (tokenId: bigint) => pad(numberToHex(tokenId), { size: 32 })
    const xfer = (id: bigint, from: Hex, to: Hex, blockNumber: bigint) =>
      makeLog({
        address: posm,
        abi: v4PositionManagerAbi,
        eventName: 'Transfer',
        args: { from, to, id },
        blockNumber,
        logIndex: 0,
      })
    addLogs(fixture, [
      makeLog({
        address: A.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'ModifyLiquidity',
        args: {
          id: pool.poolId as Hex,
          sender: posm,
          tickLower: -100,
          tickUpper: 100,
          liquidityDelta: 1_000n,
          salt: salt(1n),
        },
        blockNumber: 100n,
        logIndex: 0,
      }),
      xfer(1n, ALICE, BOB, 150n), // sold: no ModifyLiquidity, owner changed
      xfer(5n, ZERO, CAROL, 160n), // minted into the other pool
      xfer(6n, BOB, ZERO, 170n), // burned: reads revert
      xfer(1n, BOB, BOB, 180n), // same token again → read once
    ])
    const key = (p: typeof pool) => ({
      currency0: p.token0.address,
      currency1: p.token1.address,
      fee: p.feePips,
      tickSpacing: p.tickSpacing ?? 0,
      hooks: ZERO,
    })
    const token = (id: bigint, p: typeof pool, owner: Hex, liquidity: bigint) => {
      registerCall(fixture, {
        to: posm,
        abi: v4PositionManagerAbi,
        functionName: 'ownerOf',
        args: [id],
        result: owner,
      })
      registerCall(fixture, {
        to: posm,
        abi: v4PositionManagerAbi,
        functionName: 'getPoolAndPositionInfo',
        args: [id],
        result: [key(p), packPositionInfo(p.poolId as Hex, -100, 100)],
      })
      registerCall(fixture, {
        to: posm,
        abi: v4PositionManagerAbi,
        functionName: 'getPositionLiquidity',
        args: [id],
        result: liquidity,
      })
    }
    token(1n, pool, BOB, 1_000n)
    token(5n, other, CAROL, 50n)
    for (const functionName of [
      'ownerOf',
      'getPoolAndPositionInfo',
      'getPositionLiquidity',
    ] as const)
      registerRevert(fixture, { to: posm, abi: v4PositionManagerAbi, functionName, args: [6n] })

    const { r, counts } = reader(fixture)
    const expected = [
      { owner: BOB, tickLower: -100, tickUpper: 100, liquidity: 1_000n, tokenId: 1n },
    ]
    expect(await r.readPositions(pool, RANGE)).toEqual(expected)
    expect(counts.get('eth_getLogs')).toBe(2)
    expect(counts.get('eth_call')).toBe(1) // tokens 1, 5, 6 from the transfer snapshot, in one multicall
    // A range holding only the Transfer still reports the position with its new owner.
    expect(await r.readPositions(pool, { fromBlock: 140n, toBlock: 200n })).toEqual(expected)
    expect(counts.get('eth_getLogs')).toBe(4)
    expect(counts.get('eth_call')).toBe(2)
    // Another v4 pool in the same range reuses the transfer snapshot: one ModifyLiquidity scan, no reads.
    expect(await r.readPositions(other, { fromBlock: 140n, toBlock: 200n })).toEqual([
      { owner: CAROL, tickLower: -100, tickUpper: 100, liquidity: 50n, tokenId: 5n },
    ])
    expect(counts.get('eth_getLogs')).toBe(5)
    expect(counts.get('eth_call')).toBe(2)
    expect(await r.readPositions(pool, { fromBlock: 300n, toBlock: 400n })).toEqual([])
  })

  it('uniswap-v4: a checksummed address override attributes NFTs to their owners, not to the PositionManager', async () => {
    const fixture = newFixture()
    const pool = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    const posm = A.uniswapV4.positionManager
    const salt = pad(numberToHex(1n), { size: 32 })
    addLogs(fixture, [
      makeLog({
        address: A.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'ModifyLiquidity',
        args: {
          id: pool.poolId as Hex,
          sender: posm,
          tickLower: -100,
          tickUpper: 100,
          liquidityDelta: 1_000n,
          salt,
        },
        blockNumber: 100n,
        logIndex: 0,
      }),
    ])
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'ownerOf',
      args: [1n],
      result: ALICE,
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPoolAndPositionInfo',
      args: [1n],
      result: [
        {
          currency0: pool.token0.address,
          currency1: pool.token1.address,
          fee: pool.feePips,
          tickSpacing: pool.tickSpacing ?? 0,
          hooks: ZERO,
        },
        packPositionInfo(pool.poolId as Hex, -100, 100),
      ],
    })
    registerCall(fixture, {
      to: posm,
      abi: v4PositionManagerAbi,
      functionName: 'getPositionLiquidity',
      args: [1n],
      result: 1_000n,
    })
    // What the chain answers if the PositionManager were (wrongly) read as a direct LP.
    registerCall(fixture, {
      to: A.uniswapV4.stateView,
      abi: v4StateViewAbi,
      functionName: 'getPositionInfo',
      args: [pool.poolId as Hex, posm, -100, 100, salt],
      result: [1_000n, 0n, 0n],
    })
    const expected = [
      { owner: ALICE, tickLower: -100, tickUpper: 100, liquidity: 1_000n, tokenId: 1n },
    ]
    expect(await reader(fixture).r.readPositions(pool, RANGE)).toEqual(expected)
    const checksummed = reader(fixture, {
      addresses: {
        uniswapV4: {
          ...A.uniswapV4,
          poolManager: getAddress(A.uniswapV4.poolManager),
          stateView: getAddress(A.uniswapV4.stateView),
          positionManager: getAddress(posm),
        },
      },
    }).r
    expect(checksummed.addresses.uniswapV4.positionManager).toBe(posm)
    expect(await checksummed.readPositions(pool, RANGE)).toEqual(expected)
  })
})
