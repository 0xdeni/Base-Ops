/**
 * Log discovery of the Aero DEXes: one `PoolCreated` filter over both v2 factories (the emitting
 * factory gives the kind), the v2 fee from `getBaseFee` with the pinned fee module, and the Aero
 * Slipstream `hooks` from the swap hook and its initial-fee flag (docs/research/base-contracts.md
 * §2.9 for the topics and the WETH/USDC values).
 */
import { describe, expect, it } from 'vitest'
import { aerodromeCLFactoryAbi } from './abi/aerodromeCLFactory.js'
import { aerodromeCLPoolAbi } from './abi/aerodromeCLPool.js'
import { aerodromePoolFactoryAbi } from './abi/aerodromePoolFactory.js'
import { aeroPoolFactoryAbi } from './abi/aeroPoolFactory.js'
import { aeroSwapHookAbi } from './abi/aeroSwapHook.js'
import { addLogs, makeLog, registerCall, registerRevert } from './fixtures/builders.js'
import { isPoolConfigChangedError } from './internal/poolErrors.js'
import { createChainReader } from './reader.js'
import {
  AERO_CL,
  AERO_V2,
  registerAeroHook,
  registerAeroV2Factory,
  registerAeroV2Pool,
} from './test/aeroHelpers.js'
import {
  addr,
  countingTransport,
  newFixture,
  poolMeta,
  TOKEN_A,
  TOKEN_B,
  TOKEN_D,
} from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

const VOLATILE = addr(0xa201)
const STABLE = addr(0xa202)
const CL_REVIEWED = addr(0xc501)
const CL_FOREIGN_HOOK = addr(0xc502)
const CL_INITIAL_FEE = addr(0xc503)
const OTHER_HOOK = addr(0x4004)

function reader(fixture: Fixture) {
  const counts = new Map<string, number>()
  const r = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
    logChunkSize: 100,
  })
  return { r, counts }
}

function v2World(): Fixture {
  const fixture = newFixture()
  const created = (address: `0x${string}`, factory: `0x${string}`, block: bigint) =>
    makeLog({
      address: factory,
      abi: aeroPoolFactoryAbi,
      eventName: 'PoolCreated',
      args: { token0: TOKEN_A.address, token1: TOKEN_D.address, pool: address, length: 1n },
      blockNumber: block,
      logIndex: 0,
    })
  addLogs(fixture, [
    created(VOLATILE, AERO_V2.volatileFactory, 120n),
    created(STABLE, AERO_V2.stableFactory, 180n),
    // An Aerodrome v2 creation log: another topic and factory, never an Aero pool.
    makeLog({
      address: AERO_V2.volatileFactory,
      abi: aerodromePoolFactoryAbi,
      eventName: 'PoolCreated',
      args: {
        token0: TOKEN_A.address,
        token1: TOKEN_B.address,
        stable: false,
        pool: addr(0xa203),
        length: 2n,
      },
      blockNumber: 150n,
      logIndex: 1,
    }),
  ])
  registerAeroV2Factory(fixture)
  const meta = (address: `0x${string}`, stable: boolean) =>
    poolMeta({ dex: 'aero-v2', address, token0: TOKEN_A, token1: TOKEN_D, stable })
  // A 1 bps override on the volatile pool; the stable factory's default 5 bps.
  registerAeroV2Pool(fixture, meta(VOLATILE, false), { reserve0: 1n, reserve1: 1n, feeBps: 1n })
  registerAeroV2Pool(fixture, meta(STABLE, true), { reserve0: 1n, reserve1: 1n, feeBps: 5n })
  return fixture
}

describe('discoverPools: aero-v2', () => {
  it('reads both factories in one filter per chunk; the emitting factory gives the kind', async () => {
    const { r, counts } = reader(v2World())
    const pools = await r.discoverPools('aero-v2', 1n, 300n)
    expect(counts.get('eth_getLogs')).toBe(3) // 300 blocks in chunks of 100, both factories each
    expect(pools).toEqual([
      {
        id: `aero-v2:${VOLATILE}`,
        dex: 'aero-v2',
        kind: 'constant-product',
        address: VOLATILE,
        poolId: null,
        token0: TOKEN_A,
        token1: TOKEN_D,
        feePips: 100, // getBaseFee 1 bps
        tickSpacing: null,
        stable: false,
        hooks: null,
        createdAtBlock: 120n,
      },
      expect.objectContaining({
        id: `aero-v2:${STABLE}`,
        kind: 'stable-swap',
        stable: true,
        feePips: 500,
        createdAtBlock: 180n,
      }),
    ])
    // The Aerodrome v2 adapter does not see the Aero logs (another topic).
    expect(await r.discoverPools('aerodrome-v2', 1n, 300n)).toEqual([])
  })

  it('fails the DEX when a factory points at another fee module', async () => {
    const fixture = v2World()
    registerAeroV2Factory(fixture, { stableModule: addr(0xfee) })
    const { r } = reader(fixture)
    const error = await r.discoverPools('aero-v2', 1n, 300n).catch((e: unknown) => e)
    expect(isPoolConfigChangedError(error)).toBe(true)
    expect(String(error)).toContain(
      `aero-v2 stable factory ${AERO_V2.stableFactory}: fee module changed (${addr(0xfee)})`,
    )
  })
})

function clWorld(): Fixture {
  const fixture = newFixture()
  const created = (pool: `0x${string}`, tickSpacing: number, block: bigint) =>
    makeLog({
      address: AERO_CL.factory,
      abi: aerodromeCLFactoryAbi,
      eventName: 'PoolCreated',
      args: { token0: TOKEN_A.address, token1: TOKEN_D.address, tickSpacing, pool },
      blockNumber: block,
      logIndex: 0,
    })
  addLogs(fixture, [
    created(CL_REVIEWED, 50, 110n),
    created(CL_FOREIGN_HOOK, 100, 120n),
    created(CL_INITIAL_FEE, 200, 130n),
  ])
  // WETH/USDC tick spacing 50 read fee() 2,055 at 53,211,635 (base-contracts.md §2.9).
  for (const [pool, fee] of [
    [CL_REVIEWED, 2_055],
    [CL_FOREIGN_HOOK, 3_000],
    [CL_INITIAL_FEE, 900],
  ] as const)
    registerCall(fixture, { to: pool, abi: aerodromeCLPoolAbi, functionName: 'fee', result: fee })
  for (const ts of [50, 100, 200])
    registerCall(fixture, {
      to: AERO_CL.factory,
      abi: aerodromeCLFactoryAbi,
      functionName: 'tickSpacingToFee',
      args: [ts],
      result: 500,
    })
  registerAeroHook(fixture, CL_REVIEWED)
  registerAeroHook(fixture, CL_FOREIGN_HOOK, { hook: OTHER_HOOK })
  registerAeroHook(fixture, CL_INITIAL_FEE, { initialFeeEnabled: true })
  return fixture
}

describe('discoverPools: aero-slipstream', () => {
  it('reads the hook with the fee: hooks is set for a foreign hook and for an initial fee', async () => {
    const { r, counts } = reader(clWorld())
    const pools = await r.discoverPools('aero-slipstream', 1n, 200n)
    expect(counts.get('eth_getLogs')).toBe(2) // one deployment, 200 blocks in chunks of 100
    expect(pools.map((p) => [p.id, p.tickSpacing, p.feePips, p.hooks])).toEqual([
      [`aero-slipstream:${CL_REVIEWED}`, 50, 2_055, null],
      [`aero-slipstream:${CL_FOREIGN_HOOK}`, 100, 3_000, OTHER_HOOK],
      [`aero-slipstream:${CL_INITIAL_FEE}`, 200, 900, AERO_CL.swapHook],
    ])
    expect(pools[0]).toMatchObject({ dex: 'aero-slipstream', kind: 'concentrated', stable: false })
    // The Aerodrome Slipstream adapter scans its own factories only.
    expect(await r.discoverPools('aerodrome-slipstream', 1n, 200n)).toEqual([])
  })

  it('falls back to tickSpacingToFee when fee() reverts, and counts an unreadable config as hooked', async () => {
    const fixture = clWorld()
    registerRevert(fixture, { to: CL_REVIEWED, abi: aerodromeCLPoolAbi, functionName: 'fee' })
    registerRevert(fixture, {
      to: AERO_CL.swapHook,
      abi: aeroSwapHookAbi,
      functionName: 'dynamicFeeConfig',
      args: [CL_REVIEWED],
    })
    const { r } = reader(fixture)
    const [reviewed] = await r.discoverPools('aero-slipstream', 1n, 200n)
    expect(reviewed).toMatchObject({ feePips: 500, hooks: AERO_CL.swapHook })
  })
})
