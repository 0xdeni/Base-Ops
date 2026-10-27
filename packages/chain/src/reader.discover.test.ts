import { NATIVE_ETH } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aerodromeCLFactoryAbi } from './abi/aerodromeCLFactory.js'
import { aerodromeCLPoolAbi } from './abi/aerodromeCLPool.js'
import { aerodromePoolFactoryAbi } from './abi/aerodromePoolFactory.js'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { v4PoolManagerAbi } from './abi/v4PoolManager.js'
import { v4StateViewAbi } from './abi/v4StateView.js'
import { computePoolId, DYNAMIC_FEE_FLAG } from './adapters/uniswapV4.js'
import { BASE_ADDRESSES as A, NATIVE_ETH_TOKEN } from './addresses.js'
import { addLogs, makeLog, registerCall, registerRevert } from './fixtures/builders.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import {
  addr,
  countingTransport,
  newFixture,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
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

describe('discoverPools', () => {
  it('uniswap-v3: PoolCreated logs, tickSpacing from the event, token metadata with fallbacks', async () => {
    const fixture = newFixture()
    const [p1, p2] = [addr(0x1001), addr(0x1002)]
    addLogs(fixture, [
      makeLog({
        address: A.uniswapV3.factory,
        abi: uniswapV3FactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKEN_A.address,
          token1: TOKEN_B.address,
          fee: 100,
          tickSpacing: 1,
          pool: p1,
        },
        blockNumber: 100n,
        logIndex: 0,
      }),
      makeLog({
        address: A.uniswapV3.factory,
        abi: uniswapV3FactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKEN_A.address,
          token1: TOKEN_C.address,
          fee: 3000,
          tickSpacing: 60,
          pool: p2,
        },
        blockNumber: 200n,
        logIndex: 5,
      }),
    ])
    const { r, counts } = reader(fixture, { logChunkSize: 100 })
    const pools = await r.discoverPools('uniswap-v3', 1n, 300n)
    expect(pools.map((p) => p.id)).toEqual([`uniswap-v3:${p1}`, `uniswap-v3:${p2}`])
    expect(pools[0]).toEqual({
      id: `uniswap-v3:${p1}`,
      dex: 'uniswap-v3',
      kind: 'concentrated',
      address: p1,
      poolId: null,
      token0: TOKEN_A,
      token1: TOKEN_B, // symbol/name decoded from bytes32
      feePips: 100,
      tickSpacing: 1,
      stable: false,
      hooks: null,
      createdAtBlock: 100n,
    })
    expect(pools[1]).toMatchObject({ feePips: 3000, tickSpacing: 60, createdAtBlock: 200n })
    expect(pools[1]?.token1).toEqual(TOKEN_C) // short address when symbol()/name() revert
    expect(counts.get('eth_getLogs')).toBe(3) // 300 blocks in chunks of 100
    expect(counts.get('eth_call')).toBe(2) // string pass + bytes32 retry, both multicalled
    const tokens = await r.readTokens([TOKEN_B.address, NATIVE_ETH, TOKEN_A.address])
    expect(tokens).toEqual([TOKEN_B, NATIVE_ETH_TOKEN, TOKEN_A])
    expect(counts.get('eth_call')).toBe(2) // cache hit, native ETH needs no call
    expect(await r.discoverPools('uniswap-v3', 301n, 400n)).toEqual([])
  })

  it('uniswap-v4: Initialize logs keyed by PoolId, native ETH currency0, dynamic fee from StateView', async () => {
    const fixture = newFixture()
    const hooks = addr(0x4000)
    const id1 = computePoolId({
      currency0: NATIVE_ETH,
      currency1: TOKEN_A.address,
      fee: 500,
      tickSpacing: 10,
      hooks: ZERO,
    })
    const id2 = computePoolId({
      currency0: TOKEN_A.address,
      currency1: TOKEN_D.address,
      fee: DYNAMIC_FEE_FLAG,
      tickSpacing: 60,
      hooks,
    })
    const sqrtPriceX96 = 1n << 96n
    addLogs(fixture, [
      makeLog({
        address: A.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'Initialize',
        args: {
          id: id1,
          currency0: NATIVE_ETH,
          currency1: TOKEN_A.address,
          fee: 500,
          tickSpacing: 10,
          hooks: ZERO,
          sqrtPriceX96,
          tick: 0,
        },
        blockNumber: 50n,
        logIndex: 0,
      }),
      makeLog({
        address: A.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'Initialize',
        args: {
          id: id2,
          currency0: TOKEN_A.address,
          currency1: TOKEN_D.address,
          fee: DYNAMIC_FEE_FLAG,
          tickSpacing: 60,
          hooks,
          sqrtPriceX96,
          tick: 0,
        },
        blockNumber: 60n,
        logIndex: 0,
      }),
    ])
    registerCall(fixture, {
      to: A.uniswapV4.stateView,
      abi: v4StateViewAbi,
      functionName: 'getSlot0',
      args: [id2],
      result: [sqrtPriceX96, 0, 0, 1234],
    })
    const { r } = reader(fixture)
    const pools = await r.discoverPools('uniswap-v4', 1n, 100n)
    expect(pools).toHaveLength(2)
    expect(pools[0]).toEqual({
      id: `uniswap-v4:${id1}`,
      dex: 'uniswap-v4',
      kind: 'concentrated',
      address: null,
      poolId: id1,
      token0: NATIVE_ETH_TOKEN,
      token1: TOKEN_A,
      feePips: 500,
      tickSpacing: 10,
      stable: false,
      hooks: ZERO,
      createdAtBlock: 50n,
    })
    expect(pools[1]).toMatchObject({
      poolId: id2,
      feePips: 1234,
      tickSpacing: 60,
      hooks,
      token1: TOKEN_D,
    })
  })

  it('aerodrome-v2: PoolCreated with stable flag, fee from PoolFactory.getFee in bps', async () => {
    const fixture = newFixture()
    const [p3, p4] = [addr(0x1003), addr(0x1004)]
    addLogs(fixture, [
      makeLog({
        address: A.aerodromeV2.poolFactory,
        abi: aerodromePoolFactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKEN_A.address,
          token1: TOKEN_D.address,
          stable: true,
          pool: p3,
          length: 1n,
        },
        blockNumber: 10n,
        logIndex: 0,
      }),
      makeLog({
        address: A.aerodromeV2.poolFactory,
        abi: aerodromePoolFactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: TOKEN_A.address,
          token1: TOKEN_B.address,
          stable: false,
          pool: p4,
          length: 2n,
        },
        blockNumber: 20n,
        logIndex: 0,
      }),
    ])
    const factory = A.aerodromeV2.poolFactory
    registerCall(fixture, {
      to: factory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getFee',
      args: [p3, true],
      result: 5n,
    })
    registerCall(fixture, {
      to: factory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getFee',
      args: [p4, false],
      result: 30n,
    })
    const { r } = reader(fixture)
    const pools = await r.discoverPools('aerodrome-v2', 1n, 100n)
    expect(pools[0]).toEqual({
      id: `aerodrome-v2:${p3}`,
      dex: 'aerodrome-v2',
      kind: 'stable-swap',
      address: p3,
      poolId: null,
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: null,
      stable: true,
      hooks: null,
      createdAtBlock: 10n,
    })
    expect(pools[1]).toMatchObject({ kind: 'constant-product', stable: false, feePips: 3000 })
  })

  it('aerodrome-slipstream: scans every CLFactory, keys by tickSpacing, fee() with factory fallback', async () => {
    const fixture = newFixture()
    const [d1, d2] = [A.aerodromeSlipstream[1]!, A.aerodromeSlipstream[2]!]
    const [p5, p6] = [addr(0x1005), addr(0x1006)]
    addLogs(fixture, [
      makeLog({
        address: d1.factory,
        abi: aerodromeCLFactoryAbi,
        eventName: 'PoolCreated',
        args: { token0: TOKEN_A.address, token1: TOKEN_D.address, tickSpacing: 100, pool: p5 },
        blockNumber: 70n,
        logIndex: 0,
      }),
      makeLog({
        address: d2.factory,
        abi: aerodromeCLFactoryAbi,
        eventName: 'PoolCreated',
        args: { token0: TOKEN_A.address, token1: TOKEN_B.address, tickSpacing: 200, pool: p6 },
        blockNumber: 30n,
        logIndex: 0,
      }),
    ])
    registerCall(fixture, { to: p5, abi: aerodromeCLPoolAbi, functionName: 'fee', result: 450 })
    registerCall(fixture, {
      to: d1.factory,
      abi: aerodromeCLFactoryAbi,
      functionName: 'tickSpacingToFee',
      args: [100],
      result: 500,
    })
    registerRevert(fixture, { to: p6, abi: aerodromeCLPoolAbi, functionName: 'fee' })
    registerCall(fixture, {
      to: d2.factory,
      abi: aerodromeCLFactoryAbi,
      functionName: 'tickSpacingToFee',
      args: [200],
      result: 3000,
    })
    const { r, counts } = reader(fixture)
    const pools = await r.discoverPools('aerodrome-slipstream', 1n, 100n)
    expect(pools.map((p) => [p.id, p.feePips, p.tickSpacing, p.createdAtBlock])).toEqual([
      [`aerodrome-slipstream:${p6}`, 3000, 200, 30n],
      [`aerodrome-slipstream:${p5}`, 450, 100, 70n],
    ])
    expect(pools[0]).toMatchObject({
      dex: 'aerodrome-slipstream',
      kind: 'concentrated',
      address: p6,
      stable: false,
      hooks: null,
    })
    expect(counts.get('eth_getLogs')).toBe(A.aerodromeSlipstream.length)
  })
})
