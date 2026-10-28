import { type Address, DEXES, NATIVE_ETH, type PoolMeta, type TokenInfo } from '@depthwatch/core'
import { encodeAbiParameters, keccak256 } from 'viem'
import { describe, expect, it } from 'vitest'
import { aerodromeCLFactoryAbi } from './abi/aerodromeCLFactory.js'
import { aerodromePoolFactoryAbi } from './abi/aerodromePoolFactory.js'
import { uniswapV3FactoryAbi } from './abi/uniswapV3Factory.js'
import { v4PoolManagerAbi } from './abi/v4PoolManager.js'
import { BASE_ADDRESSES as A, NATIVE_ETH_TOKEN, resolveAddresses, TOKENS } from './addresses.js'
import { addLogs, makeLog, registerCallHistory, setClock } from './fixtures/builders.js'
import { registerSeedWorld, type SeedWorldPool } from './fixtures/seedWorld.js'
import { createChainReader } from './reader.js'
import { probesFor, slot0SqrtPrice, sortedPairs, v4Slot0Slot } from './seed/index.js'
import { addr, countingTransport, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixture, createFixtureTransport, type Fixture } from './transport/fixture.js'

const HEAD = 45_000_000n
const USDC = TOKENS.USDC
const REFERENCE: TokenInfo[] = [NATIVE_ETH_TOKEN, USDC, TOKEN_A, TOKEN_D]
const addresses = resolveAddresses({ referenceTokens: REFERENCE })

const V3_A = addr(0x3001)
const V3_B = addr(0x3002)
const V2_STABLE = addr(0x2001)
const CL = addr(0x5001)
const POOLS: SeedWorldPool[] = [
  {
    dex: 'uniswap-v3',
    tokens: [USDC.address, TOKEN_A.address],
    fee: 500,
    address: V3_A,
    createdAtBlock: 2_000_000n,
  },
  {
    dex: 'uniswap-v3',
    tokens: [TOKEN_D.address, TOKEN_A.address],
    fee: 100,
    address: V3_B,
    createdAtBlock: A.uniswapV3.startBlock,
  },
  {
    dex: 'aerodrome-v2',
    tokens: [USDC.address, TOKEN_D.address],
    stable: true,
    address: V2_STABLE,
    createdAtBlock: 5_000_001n,
    liveFee: 5,
  },
  {
    dex: 'aerodrome-slipstream',
    tokens: [TOKEN_A.address, USDC.address],
    tickSpacing: 100,
    deployment: 1,
    address: CL,
    createdAtBlock: 40_000_000n,
    liveFee: 450,
  },
  {
    dex: 'uniswap-v4',
    tokens: [USDC.address, NATIVE_ETH],
    fee: 500,
    tickSpacing: 10,
    createdAtBlock: 25_400_000n,
  },
  {
    dex: 'uniswap-v4',
    tokens: [TOKEN_A.address, TOKEN_D.address],
    fee: 3_000,
    tickSpacing: 60,
    createdAtBlock: HEAD,
  },
]

function world(pools: readonly SeedWorldPool[] = POOLS): Fixture {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, { addresses, pools })
  return fixture
}

function reader(fixture: Fixture) {
  const counts = new Map<string, number>()
  const transport = countingTransport(createFixtureTransport(fixture), counts)
  const r = createChainReader({ transport, addresses, logChunkSize: 100_000_000 })
  return { r, counts }
}

/** The creation logs of the same pools, for comparing against log discovery. */
function creationLogs(fixture: Fixture): void {
  const [v3a, v3b, v2, cl, v4a, v4b] = POOLS
  const sorted = (p: SeedWorldPool | undefined) =>
    [...(p?.tokens ?? [])].map((t) => t.toLowerCase()).sort() as [Address, Address]
  const v4 = (p: SeedWorldPool | undefined, id: `0x${string}`) =>
    makeLog({
      address: A.uniswapV4.poolManager,
      abi: v4PoolManagerAbi,
      eventName: 'Initialize',
      args: {
        id,
        currency0: sorted(p)[0],
        currency1: sorted(p)[1],
        fee: p?.fee,
        tickSpacing: p?.tickSpacing,
        hooks: NATIVE_ETH,
        sqrtPriceX96: 1n << 96n,
        tick: 0,
      },
      blockNumber: p?.createdAtBlock ?? 0n,
      logIndex: 1,
    })
  const v3Log = (p: SeedWorldPool | undefined) =>
    makeLog({
      address: A.uniswapV3.factory,
      abi: uniswapV3FactoryAbi,
      eventName: 'PoolCreated',
      args: {
        token0: sorted(p)[0],
        token1: sorted(p)[1],
        fee: p?.fee,
        tickSpacing: p?.fee === 100 ? 1 : 10,
        pool: p?.address,
      },
      blockNumber: p?.createdAtBlock ?? 0n,
      logIndex: 0,
    })
  addLogs(fixture, [
    v3Log(v3a),
    v3Log(v3b),
    makeLog({
      address: A.aerodromeV2.poolFactory,
      abi: aerodromePoolFactoryAbi,
      eventName: 'PoolCreated',
      args: {
        token0: sorted(v2)[0],
        token1: sorted(v2)[1],
        stable: true,
        pool: V2_STABLE,
        length: 1n,
      },
      blockNumber: v2?.createdAtBlock ?? 0n,
      logIndex: 0,
    }),
    makeLog({
      address: A.aerodromeSlipstream[1]?.factory as Address,
      abi: aerodromeCLFactoryAbi,
      eventName: 'PoolCreated',
      args: { token0: sorted(cl)[0], token1: sorted(cl)[1], tickSpacing: 100, pool: CL },
      blockNumber: cl?.createdAtBlock ?? 0n,
      logIndex: 0,
    }),
    v4(v4a, ETH_USDC_500_ID),
    v4(v4b, keccak256(encodeV4Key(sorted(v4b), 3_000, 60))),
  ])
}

const encodeV4Key = ([c0, c1]: readonly [Address, Address], fee: number, tickSpacing: number) =>
  encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [c0, c1, fee, tickSpacing, NATIVE_ETH],
  )

/** docs/research/base-contracts.md worked example: ETH/USDC, fee 500, tickSpacing 10, no hooks. */
const ETH_USDC_500_ID = '0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a'

const byId = (pools: readonly PoolMeta[]) => [...pools].sort((a, b) => (a.id < b.id ? -1 : 1))

describe('seedPools', () => {
  it('finds every DEX pool of the token pairs and builds the PoolMeta log discovery builds', async () => {
    const fixture = world()
    creationLogs(fixture)
    const { r, counts } = reader(fixture)
    const seeded = await r.seedPools()
    expect(seeded.blockNumber).toBe(HEAD)
    // 3 ERC-20 pairs: v3 × 7 enabled tiers, v2 × 2, Slipstream × 3 factories × 5 spacings; v4: 6 × 4;
    // Aero v2 × 2 factories, Aero Slipstream × 7 spacings (reader.aeroSeed.test.ts finds pools).
    expect(seeded.dexes).toEqual([
      { dex: 'uniswap-v3', candidates: 21, found: 2, searched: 2 },
      { dex: 'uniswap-v4', candidates: 24, found: 2, searched: 2 },
      { dex: 'aerodrome-v2', candidates: 6, found: 1, searched: 1 },
      { dex: 'aerodrome-slipstream', candidates: 45, found: 1, searched: 1 },
      { dex: 'aero-v2', candidates: 6, found: 0, searched: 0 },
      { dex: 'aero-slipstream', candidates: 21, found: 0, searched: 0 },
    ])
    expect(seeded.failed).toEqual([])
    const discovered = (
      await Promise.all(DEXES.map((dex) => r.discoverPools(dex, 0n, HEAD)))
    ).flat()
    expect(discovered).toHaveLength(6)
    expect(byId(seeded.pools)).toEqual(byId(discovered))
    const created = new Map(seeded.pools.map((p) => [p.address ?? p.poolId, p.createdAtBlock]))
    expect(created.get(V3_A)).toBe(2_000_000n)
    expect(created.get(V3_B)).toBe(A.uniswapV3.startBlock) // created at the lower bound
    expect(created.get(V2_STABLE)).toBe(5_000_001n)
    expect(created.get(CL)).toBe(40_000_000n)
    expect(created.get(ETH_USDC_500_ID)).toBe(25_400_000n)
    const atHead = seeded.pools.find((p) => p.createdAtBlock === HEAD)
    expect(atHead?.token0.address).toBe(TOKEN_A.address) // initialized at the seed block itself
    expect(seeded.pools.find((p) => p.id === `aerodrome-v2:${V2_STABLE}`)?.feePips).toBe(500)
    // Search cost: one eth_getCode per contract pool and round, ⌈log2(span)⌉ rounds each.
    const codeProbes =
      probesFor(A.uniswapV3.startBlock, HEAD) * 2 +
      probesFor(A.aerodromeV2.startBlock, HEAD) +
      probesFor(A.aerodromeSlipstream[1]?.startBlock ?? 0n, HEAD)
    // A binary search over n blocks takes ⌊log2 n⌋ or ⌈log2 n⌉ probes, depending on the target.
    const getCode = counts.get('eth_getCode') ?? 0
    expect(getCode).toBeLessThanOrEqual(codeProbes)
    expect(getCode).toBeGreaterThanOrEqual(codeProbes - 4)
    expect(seeded.searchRounds).toBeLessThanOrEqual(probesFor(A.uniswapV3.startBlock, HEAD))
    // Both v4 pools share their bounds, so their probes share one multicall per round.
    const v4Rounds = probesFor(A.uniswapV4.startBlock, HEAD)
    expect(seeded.searchRequests).toBeGreaterThanOrEqual(getCode + v4Rounds - 1)
    expect(seeded.searchRequests).toBeLessThanOrEqual(getCode + 2 * v4Rounds)
  })

  it('computes v4 PoolKey ids as keccak256(abi.encode(key)) with sorted currencies', async () => {
    const { r } = reader(world())
    const seeded = await r.seedPools({ dexes: ['uniswap-v4'] })
    const ethUsdc = seeded.pools.find((p) => p.createdAtBlock === 25_400_000n)
    const expected = keccak256(encodeV4Key([NATIVE_ETH, USDC.address], 500, 10))
    expect(expected).toBe(ETH_USDC_500_ID)
    expect(ethUsdc).toMatchObject({
      id: `uniswap-v4:${ETH_USDC_500_ID}`,
      poolId: ETH_USDC_500_ID,
      token0: NATIVE_ETH_TOKEN,
      token1: USDC,
      feePips: 500,
      tickSpacing: 10,
      hooks: NATIVE_ETH,
      address: null,
    })
  })

  it('skips the creation search for known pools and only asks the factories again', async () => {
    const { r, counts } = reader(world())
    const known = new Map([[`uniswap-v3:${V3_A}`, 1_999_999n]])
    const seeded = await r.seedPools({
      dexes: ['uniswap-v3'],
      knownCreatedAt: (id) => known.get(id),
    })
    expect(seeded.dexes).toEqual([{ dex: 'uniswap-v3', candidates: 21, found: 2, searched: 1 }])
    expect(seeded.pools.find((p) => p.address === V3_A)?.createdAtBlock).toBe(1_999_999n)
    expect(counts.get('eth_getCode')).toBeLessThanOrEqual(probesFor(A.uniswapV3.startBlock, HEAD))
    // feeAmountTickSpacing, getPool, then token metadata of the known pool and of the searched one.
    expect(counts.get('eth_call')).toBe(4)
  })

  it('asks only the fee tiers and tick spacings the factories enable', async () => {
    const fixture = createFixture()
    setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
    registerSeedWorld(fixture, {
      addresses,
      pools: [],
      v3TickSpacings: { 100: 1, 500: 10, 3000: 60, 10000: 200 }, // 200, 300, 400 answer 0
      slipstreamTickSpacings: [[1, 50], [10], [1, 50, 100, 200, 2_000, 500, 10, 80, 150]],
    })
    const { r, counts } = reader(fixture)
    const seeded = await r.seedPools({ dexes: ['uniswap-v3', 'aerodrome-slipstream'] })
    expect(seeded.dexes.map((d) => d.candidates)).toEqual([3 * 4, 3 * (2 + 1 + 9)])
    expect(seeded.pools).toEqual([])
    expect(seeded.searchRequests).toBe(0)
    expect(counts.get('eth_getCode')).toBeUndefined()
  })

  it('refuses v4 pools whose PoolManager slot0 word disagrees with StateView', async () => {
    const fixture = world()
    const id = ETH_USDC_500_ID as `0x${string}`
    registerCallHistory(fixture, {
      to: A.uniswapV4.poolManager,
      abi: v4PoolManagerAbi,
      functionName: 'extsload',
      args: [v4Slot0Slot(id)],
      history: [{ fromBlock: 25_400_000n, result: `0x${'0'.repeat(64)}` }],
    })
    const { r } = reader(fixture)
    const seeded = await r.seedPools({ dexes: ['uniswap-v4'] })
    expect(seeded).toMatchObject({ pools: [], dexes: [], searchRequests: 0 })
    expect(seeded.failed).toEqual([
      { dex: 'uniswap-v4', error: expect.stringMatching(/PoolManager slot0 of/) },
    ])
  })
})

describe('seed helpers', () => {
  it('sortedPairs dedupes, lowercases and orders each pair as the factories do', () => {
    const upper = TOKEN_D.address.toUpperCase().replace('0X', '0x') as Address
    expect(sortedPairs([TOKEN_D.address, NATIVE_ETH, TOKEN_A.address, upper])).toEqual([
      [NATIVE_ETH, TOKEN_A.address],
      [NATIVE_ETH, TOKEN_D.address],
      [TOKEN_A.address, TOKEN_D.address],
    ])
  })

  it('probesFor is ⌈log2(span)⌉ and slot0SqrtPrice keeps the low 160 bits', () => {
    expect([probesFor(5n, 5n), probesFor(5n, 6n), probesFor(5n, 8n), probesFor(5n, 9n)]).toEqual([
      0, 1, 2, 3,
    ])
    expect(probesFor(1_371_680n, 53_056_381n)).toBe(26)
    expect(slot0SqrtPrice(`0x${'01f4'.padStart(24, '0')}${'0'.repeat(39)}5`)).toBe(5n)
    expect(slot0SqrtPrice(undefined)).toBe(0n)
  })
})
