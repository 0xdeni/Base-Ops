import type { Hex } from '@depthwatch/core'
import { encodeEventTopics } from 'viem'
import { describe, expect, it } from 'vitest'
import { aerodromePoolAbi } from './abi/aerodromePool.js'
import { uniswapV3PoolAbi } from './abi/uniswapV3Pool.js'
import { v4PoolManagerAbi } from './abi/v4PoolManager.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { addLogs, makeLog, registerLogsError } from './fixtures/builders.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import { addr, countingTransport, newFixture, poolMeta, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

function reader(fixture: Fixture, opts: CreateChainReaderOptions = {}) {
  const counts = new Map<string, number>()
  const r = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
    ...opts,
  })
  return { r, counts }
}

const ROUTER = addr(0x7007)

describe('readSwaps', () => {
  it('maps v3/v4/Aerodrome Swap logs to pool deltas, halves oversized chunks, interpolates timestamps', async () => {
    const LATEST = 2_000n
    const LATEST_TS = 3_000_000
    const fixture = newFixture(LATEST, LATEST_TS)
    const v3 = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x401),
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    const v4 = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 500,
      tickSpacing: 10,
    })
    const otherV4 = poolMeta({
      dex: 'uniswap-v4',
      token0: TOKEN_A,
      token1: TOKEN_D,
      feePips: 3000,
      tickSpacing: 60,
    })
    const v2 = poolMeta({
      dex: 'aerodrome-v2',
      address: addr(0x403),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    const v3Swap = (blockNumber: bigint, logIndex: number, amount0: bigint, amount1: bigint) =>
      makeLog({
        address: v3.address as Hex,
        abi: uniswapV3PoolAbi,
        eventName: 'Swap',
        args: {
          sender: ROUTER,
          recipient: ROUTER,
          amount0,
          amount1,
          sqrtPriceX96: 1n << 96n,
          liquidity: 1n,
          tick: 0,
        },
        blockNumber,
        logIndex,
      })
    const v4Swap = (
      id: Hex,
      blockNumber: bigint,
      logIndex: number,
      amount0: bigint,
      amount1: bigint,
    ) =>
      makeLog({
        address: A.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'Swap',
        args: {
          id,
          sender: ROUTER,
          amount0,
          amount1,
          sqrtPriceX96: 1n << 96n,
          liquidity: 1n,
          tick: 0,
          fee: 500,
        },
        blockNumber,
        logIndex,
      })
    addLogs(fixture, [
      v3Swap(1_010n, 3, 1_000n, -2_000n),
      v3Swap(1_150n, 0, -5n, 9n),
      // v4 amounts are the swapper's deltas: negative = paid into the pool.
      v4Swap(v4.poolId as Hex, 1_020n, 1, -1_000n, 2_000n),
      v4Swap(otherV4.poolId as Hex, 1_021n, 0, -1n, 1n),
      makeLog({
        address: v2.address as Hex,
        abi: aerodromePoolAbi,
        eventName: 'Swap',
        args: {
          sender: ROUTER,
          to: ROUTER,
          amount0In: 500n,
          amount1In: 0n,
          amount0Out: 0n,
          amount1Out: 700n,
        },
        blockNumber: 1_030n,
        logIndex: 2,
      }),
    ])
    const swapTopic = encodeEventTopics({ abi: uniswapV3PoolAbi, eventName: 'Swap' })[0] as Hex
    registerLogsError(fixture, {
      address: [v3.address as Hex],
      topics: [swapTopic],
      fromBlock: 1_000n,
      toBlock: 1_099n,
      message: 'query returned more than 10000 results',
    })
    // 100-block chunks halve to 50: below the default floor, so lower it for this fixture.
    const { r, counts } = reader(fixture, { logChunkSize: 100, minLogRange: 50 })
    const events = await r.readSwaps([v3, v4, v2], 1_000n, 1_199n)
    expect(events.map((e) => [e.poolId, e.blockNumber, e.logIndex, e.amount0, e.amount1])).toEqual([
      [v3.id, 1_010n, 3, 1_000n, -2_000n],
      [v4.id, 1_020n, 1, 1_000n, -2_000n],
      [v2.id, 1_030n, 2, 500n, -700n],
      [v3.id, 1_150n, 0, -5n, 9n],
    ])
    expect(events.map((e) => e.timestamp)).toEqual(
      [1_010n, 1_020n, 1_030n, 1_150n].map((b) => LATEST_TS - Number(LATEST - b) * 2),
    )
    expect(events.every((e) => /^0x[0-9a-f]{64}$/.test(e.txHash))).toBe(true)
    // v3: failed chunk + two halves + second chunk; v4 and v2: two chunks each.
    expect(counts.get('eth_getLogs')).toBe(8)
    // Timestamp anchors are independent of the log chunk: blocks 0 and 1 199 (the scan's end).
    expect(counts.get('eth_getBlockByNumber')).toBe(2)
    expect(await r.readSwaps([], 1n, 2n)).toEqual([])
    expect(await r.readSwaps([v3], 5n, 2n)).toEqual([])
  })
})
