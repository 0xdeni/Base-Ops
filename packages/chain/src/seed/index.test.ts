/**
 * `seedPools` runs the DEX seeders independently: a DEX whose factory views fail is reported in
 * `failed`, and the pools of the other DEXes are still dated and returned. Every DEX has a seeder
 * and an adapter.
 */
import { DEXES, NATIVE_ETH } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aerodromePoolFactoryAbi } from '../abi/aerodromePoolFactory.js'
import { aeroPoolFactoryAbi } from '../abi/aeroPoolFactory.js'
import { ADAPTERS } from '../adapters/index.js'
import { BASE_ADDRESSES as A, NATIVE_ETH_TOKEN, resolveAddresses, TOKENS } from '../addresses.js'
import { registerRevert, setClock } from '../fixtures/builders.js'
import { registerSeedWorld, type SeedWorldPool } from '../fixtures/seedWorld.js'
import { createChainReader } from '../reader.js'
import { addr, countingTransport } from '../test/helpers.js'
import { createFixture, createFixtureTransport } from '../transport/fixture.js'
import { probesFor, SEEDERS, sortedPairs } from './index.js'

const HEAD = 45_000_000n
const { WETH, USDC, CBBTC } = TOKENS
const addresses = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC, CBBTC] })
const V3 = addr(0x3001)
const V2 = addr(0x2001)
const POOLS: SeedWorldPool[] = [
  {
    dex: 'uniswap-v3',
    tokens: [WETH.address, USDC.address],
    fee: 500,
    address: V3,
    createdAtBlock: 2_000_123n,
  },
  {
    dex: 'aerodrome-v2',
    tokens: [CBBTC.address, WETH.address],
    stable: false,
    address: V2,
    createdAtBlock: 9_000_000n,
  },
  {
    dex: 'uniswap-v4',
    tokens: [NATIVE_ETH, USDC.address],
    fee: 500,
    tickSpacing: 10,
    createdAtBlock: 26_000_000n,
  },
]

describe('seedPools: one DEX failing', () => {
  it('one rejecting seeder still returns the other DEXes’ pools', async () => {
    const fixture = createFixture()
    setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
    registerSeedWorld(fixture, { addresses, pools: POOLS })
    const [t0, t1] = sortedPairs([CBBTC.address, WETH.address])[0] ?? []
    // The Aerodrome v2 factory reverts on one pair, as a factory whose interface changed would.
    registerRevert(fixture, {
      to: A.aerodromeV2.poolFactory,
      abi: aerodromePoolFactoryAbi,
      functionName: 'getPool',
      args: [t0 ?? WETH.address, t1 ?? CBBTC.address, false],
      blocks: [HEAD],
    })
    const counts = new Map<string, number>()
    const transport = countingTransport(createFixtureTransport(fixture), counts)
    const r = createChainReader({ transport, addresses })
    const seeded = await r.seedPools()
    expect(seeded.pools.map((p) => p.dex).sort()).toEqual(['uniswap-v3', 'uniswap-v4'])
    expect(seeded.pools.find((p) => p.address === V3)?.createdAtBlock).toBe(2_000_123n)
    expect(seeded.pools.find((p) => p.dex === 'uniswap-v4')?.createdAtBlock).toBe(26_000_000n)
    expect(seeded.dexes.map((d) => d.dex)).toEqual([
      'uniswap-v3',
      'uniswap-v4',
      'aerodrome-slipstream',
      'aero-v2',
      'aero-slipstream',
    ])
    expect(seeded.failed).toEqual([
      { dex: 'aerodrome-v2', error: expect.stringMatching(/aerodrome-v2 getPool\(.*\) failed/) },
    ])
    // Only the Uniswap v3 pool was dated by eth_getCode: the Aerodrome v2 pool was never searched.
    expect(counts.get('eth_getCode')).toBe(probesFor(A.uniswapV3.startBlock, HEAD))
  })

  it('a failing Aero seeder does not block the others', async () => {
    const fixture = createFixture()
    setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
    registerSeedWorld(fixture, { addresses, pools: POOLS })
    const [t0, t1] = sortedPairs([WETH.address, USDC.address])[0] ?? []
    // The stable factory reverts on one pair, as a factory whose interface changed would.
    registerRevert(fixture, {
      to: A.aeroV2.stableFactory,
      abi: aeroPoolFactoryAbi,
      functionName: 'getPool',
      args: [t0 ?? WETH.address, t1 ?? USDC.address],
      blocks: [HEAD],
    })
    const r = createChainReader({ transport: createFixtureTransport(fixture), addresses })
    const seeded = await r.seedPools()
    expect(seeded.pools.map((p) => p.dex).sort()).toEqual([
      'aerodrome-v2',
      'uniswap-v3',
      'uniswap-v4',
    ])
    expect(seeded.dexes.map((d) => d.dex)).not.toContain('aero-v2')
    expect(seeded.failed).toEqual([
      { dex: 'aero-v2', error: expect.stringMatching(/aero-v2 getPool\(.*\) on 0x7858.* failed/) },
    ])
  })

  it('has a seeder and an adapter for every DEX', () => {
    expect(Object.keys(SEEDERS).sort()).toEqual([...DEXES].sort())
    expect(Object.keys(ADAPTERS).sort()).toEqual([...DEXES].sort())
    for (const dex of DEXES) expect(ADAPTERS[dex].dex).toBe(dex)
  })

  it('returns no pools and every DEX in failed when every seeder fails', async () => {
    const fixture = createFixture()
    setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
    const r = createChainReader({ transport: createFixtureTransport(fixture), addresses })
    const seeded = await r.seedPools({ dexes: ['uniswap-v3', 'aerodrome-v2'] })
    expect(seeded).toMatchObject({ pools: [], dexes: [], searchRequests: 0 })
    expect(seeded.failed.map((f) => f.dex)).toEqual(['uniswap-v3', 'aerodrome-v2'])
  })
})
