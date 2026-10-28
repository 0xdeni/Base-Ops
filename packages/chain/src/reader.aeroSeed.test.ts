/**
 * Seeded discovery of the Aero DEXes: the 2-argument `getPool` on both v2 factories (the
 * 3-argument Aerodrome form is never sent), `tickSpacings()` then `getPool` on the CLFactory,
 * creation blocks searched from the factories' start blocks, and the PoolMeta log discovery builds
 * for the same pools, swap-hook reads included, also for pools whose creation block is known.
 */
import { type Address, DEXES, type PoolMeta } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aerodromeCLFactoryAbi } from './abi/aerodromeCLFactory.js'
import { aerodromePoolFactoryAbi } from './abi/aerodromePoolFactory.js'
import { aeroPoolFactoryAbi } from './abi/aeroPoolFactory.js'
import { NATIVE_ETH_TOKEN, resolveAddresses, TOKENS } from './addresses.js'
import { addLogs, makeLog, setClock } from './fixtures/builders.js'
import { registerSeedWorld, type SeedWorldPool } from './fixtures/seedWorld.js'
import { createChainReader } from './reader.js'
import { probesFor } from './seed/index.js'
import {
  AERO_CL,
  AERO_V2,
  callOf,
  callRecorder,
  registerAeroV2Factory,
} from './test/aeroHelpers.js'
import { addr, countingTransport, TOKEN_A } from './test/helpers.js'
import { createFixture, createFixtureTransport, type Fixture } from './transport/fixture.js'

const HEAD = 53_213_030n
const { WETH, USDC } = TOKENS
const addresses = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC, TOKEN_A] })

const VOLATILE = addr(0xa401)
const STABLE = addr(0xa402)
const CL = addr(0xc701)
const CL_INITIAL = addr(0xc702)
/** First `PoolCreated` blocks of the three Aero factories (base-contracts.md §2.9). */
const POOLS: SeedWorldPool[] = [
  {
    dex: 'aero-v2',
    tokens: [USDC.address, WETH.address],
    address: VOLATILE,
    createdAtBlock: 52_884_700n,
  },
  {
    dex: 'aero-v2',
    tokens: [WETH.address, TOKEN_A.address],
    stable: true,
    address: STABLE,
    createdAtBlock: 52_886_973n,
    liveFee: 4,
  },
  {
    dex: 'aero-slipstream',
    tokens: [WETH.address, USDC.address],
    tickSpacing: 50,
    address: CL,
    createdAtBlock: 52_885_483n,
    liveFee: 465,
  },
  {
    dex: 'aero-slipstream',
    tokens: [USDC.address, TOKEN_A.address],
    tickSpacing: 100,
    address: CL_INITIAL,
    createdAtBlock: 53_000_000n,
    initialFeeEnabled: true,
  },
]

const sorted = (pool: SeedWorldPool) =>
  [...pool.tokens].map((t) => t.toLowerCase()).sort() as [Address, Address]

function world(pools: readonly SeedWorldPool[] = POOLS): Fixture {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, { addresses, pools })
  addLogs(
    fixture,
    pools.map((p) => {
      const [token0, token1] = sorted(p)
      const common = { blockNumber: p.createdAtBlock, logIndex: 0 }
      if (p.dex === 'aero-v2')
        return makeLog({
          address: p.stable ? AERO_V2.stableFactory : AERO_V2.volatileFactory,
          abi: aeroPoolFactoryAbi,
          eventName: 'PoolCreated',
          args: { token0, token1, pool: p.address, length: 1n },
          ...common,
        })
      return makeLog({
        address: AERO_CL.factory,
        abi: aerodromeCLFactoryAbi,
        eventName: 'PoolCreated',
        args: { token0, token1, tickSpacing: p.tickSpacing, pool: p.address },
        ...common,
      })
    }),
  )
  return fixture
}

function reader(fixture: Fixture) {
  const counts = new Map<string, number>()
  const recorded = callRecorder(createFixtureTransport(fixture))
  const transport = countingTransport(recorded.transport, counts)
  const r = createChainReader({ transport, addresses, logChunkSize: 1_000_000 })
  return { r, counts, requests: recorded.requests }
}

const byId = (pools: readonly PoolMeta[]) => [...pools].sort((a, b) => (a.id < b.id ? -1 : 1))

describe('seedPools: Aero', () => {
  it('asks both v2 factories with the 2-argument getPool and the CLFactory per spacing', async () => {
    const { r, counts, requests } = reader(world())
    const seeded = await r.seedPools({ dexes: ['aero-v2', 'aero-slipstream'] })
    // 3 ERC-20 pairs: × 2 v2 factories, × 7 CL tick spacings.
    expect(seeded.dexes).toEqual([
      { dex: 'aero-v2', candidates: 6, found: 2, searched: 2 },
      { dex: 'aero-slipstream', candidates: 21, found: 2, searched: 2 },
    ])
    expect(seeded.failed).toEqual([])
    const asked = requests.flat()
    for (const factory of [AERO_V2.volatileFactory, AERO_V2.stableFactory]) {
      expect(asked).toContain(callOf(factory, aeroPoolFactoryAbi, 'getPool'))
      expect(asked).not.toContain(callOf(factory, aerodromePoolFactoryAbi, 'getPool'))
    }
    expect(asked).toContain(callOf(AERO_CL.factory, aerodromeCLFactoryAbi, 'tickSpacings'))
    // The creation search starts at the factories' first blocks.
    const created = new Map(seeded.pools.map((p) => [p.address, p.createdAtBlock]))
    expect(Object.fromEntries(created)).toEqual(
      Object.fromEntries(POOLS.map((p) => [p.address, p.createdAtBlock])),
    )
    const bound = 2 * probesFor(AERO_V2.startBlock, HEAD) + 2 * probesFor(AERO_CL.startBlock, HEAD)
    expect(counts.get('eth_getCode')).toBeLessThanOrEqual(bound)
    expect(counts.get('eth_getCode')).toBeGreaterThanOrEqual(bound - 4)
  })

  it('builds the PoolMeta log discovery builds, hooks and fees included', async () => {
    const { r } = reader(world())
    const seeded = await r.seedPools({ dexes: ['aero-v2', 'aero-slipstream'] })
    const discovered = [
      ...(await r.discoverPools('aero-v2', AERO_V2.startBlock, HEAD)),
      ...(await r.discoverPools('aero-slipstream', AERO_CL.startBlock, HEAD)),
    ]
    expect(byId(seeded.pools)).toEqual(byId(discovered))
    const get = (address: Address) => seeded.pools.find((p) => p.address === address)
    expect(get(VOLATILE)).toMatchObject({ kind: 'constant-product', feePips: 3_000, hooks: null })
    expect(get(STABLE)).toMatchObject({ kind: 'stable-swap', stable: true, feePips: 400 })
    expect(get(CL)).toMatchObject({ feePips: 465, tickSpacing: 50, hooks: null })
    expect(get(CL_INITIAL)?.hooks).toBe(AERO_CL.swapHook)
  })

  it('reads the hooks again for pools whose creation block is known', async () => {
    const other = addr(0x4004)
    const pools = POOLS.map((p) => (p.address === CL ? { ...p, swapHook: other } : p))
    const { r, counts } = reader(world(pools))
    const known = new Map([[`aero-slipstream:${CL}`, 52_885_483n]])
    const seeded = await r.seedPools({
      dexes: ['aero-slipstream'],
      knownCreatedAt: (id) => known.get(id),
    })
    expect(seeded.dexes).toEqual([
      { dex: 'aero-slipstream', candidates: 21, found: 2, searched: 1 },
    ])
    expect(seeded.pools.find((p) => p.address === CL)?.hooks).toBe(other)
    expect(counts.get('eth_getCode')).toBeLessThanOrEqual(probesFor(AERO_CL.startBlock, HEAD))
  })

  it('lists aero-v2 in failed when a factory points at another fee module, before any search', async () => {
    const fixture = world()
    registerAeroV2Factory(fixture, { volatileModule: addr(0xfee), blocks: [HEAD] })
    const { r } = reader(fixture)
    const seeded = await r.seedPools()
    expect(seeded.failed).toEqual([
      {
        dex: 'aero-v2',
        error: `aero-v2 volatile factory ${AERO_V2.volatileFactory}: fee module changed (${addr(0xfee)})`,
      },
    ])
    expect(seeded.dexes.map((d) => d.dex)).toEqual(DEXES.filter((d) => d !== 'aero-v2'))
    expect(seeded.pools.map((p) => p.dex)).toEqual(['aero-slipstream', 'aero-slipstream'])
  })
})
