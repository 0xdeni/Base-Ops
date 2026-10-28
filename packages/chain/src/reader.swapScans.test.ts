/**
 * `readSwaps` scans per `Swap` event source: Uniswap v3 and both Slipstreams emit the same event
 * (checked here against both ABIs), as do Aerodrome v2 and Aero v2 pools, so their pools share one
 * filter per range: three sources for six DEXes. Every scan reports chunks and backoffs to one
 * progress object.
 */
import { DEXES, type Hex } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aerodromeCLPoolAbi } from './abi/aerodromeCLPool.js'
import { aerodromePoolAbi } from './abi/aerodromePool.js'
import { uniswapV3PoolAbi } from './abi/uniswapV3Pool.js'
import { v4PoolManagerAbi } from './abi/v4PoolManager.js'
import { addLogs, makeLog } from './fixtures/builders.js'
import { eventTopics } from './internal/logs.js'
import { type SwapScanProgress, swapScanGroups, swapScanOf } from './internal/swapScans.js'
import { createChainReader } from './reader.js'
import { addr, countingTransport, newFixture, poolMeta, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport, FixtureRpcError } from './transport/fixture.js'

/** keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"). */
const V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'

const v3 = poolMeta({ dex: 'uniswap-v3', address: addr(0x401), token0: TOKEN_A, token1: TOKEN_D })
const slip = poolMeta({
  dex: 'aerodrome-slipstream',
  address: addr(0x402),
  token0: TOKEN_A,
  token1: TOKEN_D,
  tickSpacing: 100,
})
const v2 = poolMeta({ dex: 'aerodrome-v2', address: addr(0x403), token0: TOKEN_A, token1: TOKEN_D })
const v4 = poolMeta({ dex: 'uniswap-v4', token0: TOKEN_A, token1: TOKEN_D })
const aeroV2 = poolMeta({ dex: 'aero-v2', address: addr(0x404), token0: TOKEN_A, token1: TOKEN_D })
const aeroCl = poolMeta({
  dex: 'aero-slipstream',
  address: addr(0x405),
  token0: TOKEN_A,
  token1: TOKEN_D,
  tickSpacing: 50,
})

const swapLog = (address: Hex, blockNumber: bigint, amount0: bigint) =>
  makeLog({
    address,
    abi: uniswapV3PoolAbi,
    eventName: 'Swap',
    args: {
      sender: addr(0x7007),
      recipient: addr(0x7007),
      amount0,
      amount1: -amount0,
      sqrtPriceX96: 1n << 96n,
      liquidity: 1n,
      tick: 0,
    },
    blockNumber,
    logIndex: 0,
  })

describe('swap event sources', () => {
  it('Slipstream emits Uniswap v3 Swap: same signature, same topic0', () => {
    const v3Topic = eventTopics(uniswapV3PoolAbi, 'Swap')
    expect(v3Topic).toBe(V3_SWAP_TOPIC)
    expect(eventTopics(aerodromeCLPoolAbi, 'Swap')).toBe(v3Topic)
    expect(eventTopics(aerodromePoolAbi, 'Swap')).not.toBe(v3Topic)
    expect(eventTopics(v4PoolManagerAbi, 'Swap')).not.toBe(v3Topic)
  })

  it('groups Uniswap v3 and Slipstream pools into one scan, the other DEXes alone', () => {
    expect(swapScanOf('aerodrome-slipstream')).toBe('uniswap-v3')
    expect(swapScanOf('uniswap-v3')).toBe('uniswap-v3')
    expect(swapScanOf('aerodrome-v2')).toBe('aerodrome-v2')
    expect(swapScanOf('uniswap-v4')).toBe('uniswap-v4')
    const groups = swapScanGroups([slip, v2, v3, v4])
    expect([...groups.keys()]).toEqual(['uniswap-v3', 'uniswap-v4', 'aerodrome-v2'])
    expect(groups.get('uniswap-v3')).toEqual([v3, slip])
  })

  it('joins Aero v2 to the Aerodrome v2 scan and Aero Slipstream to the v3 one', () => {
    expect(swapScanOf('aero-v2')).toBe('aerodrome-v2')
    expect(swapScanOf('aero-slipstream')).toBe('uniswap-v3')
    expect(new Set(DEXES.map(swapScanOf)).size).toBe(3)
    const groups = swapScanGroups([aeroCl, aeroV2, slip, v2, v3, v4])
    expect([...groups.keys()]).toEqual(['uniswap-v3', 'uniswap-v4', 'aerodrome-v2'])
    expect(groups.get('uniswap-v3')).toEqual([v3, slip, aeroCl])
    expect(groups.get('aerodrome-v2')).toEqual([v2, aeroV2])
  })
})

describe('readSwaps over v3 and Slipstream pools', () => {
  it('reads both DEXes in one filter per chunk and attributes every log to its pool', async () => {
    const fixture = newFixture(2_000n, 3_000_000)
    addLogs(fixture, [
      swapLog(v3.address as Hex, 1_005n, 7n),
      swapLog(slip.address as Hex, 1_015n, 11n),
    ])
    const counts = new Map<string, number>()
    const reader = createChainReader({
      transport: countingTransport(createFixtureTransport(fixture), counts),
      logChunkSize: 10,
    })
    const progress: SwapScanProgress[] = []
    const swaps = await reader.readSwaps([v3, slip], 1_001n, 1_020n, {
      onProgress: (p) => progress.push(p),
    })
    expect(swaps.map((s) => [s.poolId, s.blockNumber, s.amount0])).toEqual([
      [v3.id, 1_005n, 7n],
      [slip.id, 1_015n, 11n],
    ])
    expect(counts.get('eth_getLogs')).toBe(2) // 20 blocks, one filter, two 10-block chunks
    expect(progress.map((p) => [p.chunks, p.blocksDone, p.blocksTotal, p.scans])).toEqual([
      [1, 10n, 20n, 1],
      [2, 20n, 20n, 1],
    ])
  })

  it('reads Aero pools in the shared filters: one eth_getLogs per source and chunk', async () => {
    const fixture = newFixture(2_000n, 3_000_000)
    addLogs(fixture, [
      swapLog(aeroCl.address as Hex, 1_003n, 5n),
      makeLog({
        address: aeroV2.address as `0x${string}`,
        abi: aerodromePoolAbi,
        eventName: 'Swap',
        args: {
          sender: addr(0x7007),
          to: addr(0x7007),
          amount0In: 9n,
          amount1In: 0n,
          amount0Out: 0n,
          amount1Out: 4n,
        },
        blockNumber: 1_004n,
        logIndex: 0,
      }),
    ])
    const counts = new Map<string, number>()
    const reader = createChainReader({
      transport: countingTransport(createFixtureTransport(fixture), counts),
      logChunkSize: 10,
    })
    const swaps = await reader.readSwaps([v3, aeroCl, v2, aeroV2], 1_001n, 1_010n)
    expect(swaps.map((s) => [s.poolId, s.amount0, s.amount1])).toEqual([
      [aeroCl.id, 5n, -5n],
      [aeroV2.id, 9n, -4n],
    ])
    expect(counts.get('eth_getLogs')).toBe(2) // two sources, one 10-block chunk each
  })

  it('counts backoffs by kind in the progress', async () => {
    const fixture = newFixture(2_000n, 3_000_000)
    addLogs(fixture, [])
    let failures = 1
    const inner = createFixtureTransport(fixture)
    const reader = createChainReader({
      transport: (config) => {
        const live = inner(config)
        return {
          ...live,
          request: async (args: { method: string; params?: unknown }) => {
            if (args.method === 'eth_getLogs' && failures-- > 0)
              throw new FixtureRpcError({ code: 429, message: 'Too Many Requests' })
            return live.request(args as never)
          },
        } as ReturnType<typeof inner>
      },
      logChunkSize: 10,
      logRetry: { sleep: async () => {} },
    })
    const progress: SwapScanProgress[] = []
    await reader.readSwaps([v2, v4], 1_001n, 1_010n, { onProgress: (p) => progress.push(p) })
    const last = progress[progress.length - 1]
    expect(last).toMatchObject({ scans: 2, chunks: 2, blocksDone: 20n, rateLimited: 1 })
  })
})
