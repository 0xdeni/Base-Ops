/**
 * State reads of the Aero DEXes. Aero v2: reserves, `getBaseFee(pool, 0x0, 0, 0, 0, 0)` and the
 * factory's `feeModule()` in one multicall, never `metadata()` or `stable()`. Aero Slipstream:
 * the fee read at the snapshot block, and the swap-hook guard riding in the first multicall, so a
 * changed hook or an enabled initial fee fails the read (docs/research/base-contracts.md §2.9:
 * WETH/USDC tick spacing 50 read `fee()` 2,055 at 53,211,635 and 645 at 53,211,732).
 */
import type { ConcentratedState } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aeroCLFactoryAbi } from './abi/aeroCLFactory.js'
import { aerodromeCLPoolAbi } from './abi/aerodromeCLPool.js'
import { aerodromePoolAbi } from './abi/aerodromePool.js'
import { aeroPoolFactoryAbi } from './abi/aeroPoolFactory.js'
import { aeroSwapHookAbi } from './abi/aeroSwapHook.js'
import { setClock } from './fixtures/builders.js'
import { isPoolConfigChangedError, PoolConfigChangedError } from './internal/poolErrors.js'
import { createChainReader } from './reader.js'
import {
  AERO_CL,
  AERO_V2,
  callOf,
  callRecorder,
  registerAeroCLPool,
  registerAeroV2Factory,
  registerAeroV2Pool,
} from './test/aeroHelpers.js'
import { addr, newFixture, poolMeta, TOKEN_A, TOKEN_D } from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

const FIRST = 53_211_635n
const SECOND = 53_211_732n

function reader(fixture: Fixture) {
  const { transport, requests } = callRecorder(createFixtureTransport(fixture))
  return { r: createChainReader({ transport }), requests }
}

function fixtureAt(): Fixture {
  const fixture = newFixture(SECOND, 1_800_000_000)
  setClock(fixture, { latestBlock: SECOND, latestTimestamp: 1_800_000_000 })
  return fixture
}

describe('readState: aero-v2', () => {
  const stable = poolMeta({
    dex: 'aero-v2',
    address: addr(0xa301),
    token0: TOKEN_A,
    token1: TOKEN_D,
    stable: true,
    feePips: 500,
  })
  const volatile = poolMeta({
    dex: 'aero-v2',
    address: addr(0xa302),
    token0: TOKEN_A,
    token1: TOKEN_D,
    feePips: 3_000,
  })

  function v2Fixture(): Fixture {
    const fixture = fixtureAt()
    registerAeroV2Factory(fixture, { blocks: [SECOND] })
    const reserves = { reserve0: 10n ** 21n, reserve1: 2n * 10n ** 9n }
    registerAeroV2Pool(fixture, stable, { ...reserves, feeBps: 4n }, [SECOND])
    registerAeroV2Pool(fixture, volatile, { ...reserves, feeBps: 30n }, [SECOND])
    return fixture
  }

  it('reads reserves, getBaseFee and feeModule() of the matching factory in one request', async () => {
    const { r, requests } = reader(v2Fixture())
    const state = await r.readState(stable, { bandPct: 5, blockNumber: SECOND })
    expect(state).toEqual({
      kind: 'stable-swap',
      blockNumber: SECOND,
      timestamp: 1_800_000_000,
      reserve0: 10n ** 21n,
      reserve1: 2n * 10n ** 9n,
      feePips: 400,
      decimals0: 18,
      decimals1: 6,
    })
    expect(requests).toEqual([
      [
        callOf(stable.address as `0x${string}`, aerodromePoolAbi, 'getReserves'),
        callOf(AERO_V2.stableFactory, aeroPoolFactoryAbi, 'getBaseFee'),
        callOf(AERO_V2.stableFactory, aeroPoolFactoryAbi, 'feeModule'),
      ],
    ])
    const v = await r.readState(volatile, { bandPct: 5, blockNumber: SECOND })
    expect(v).toMatchObject({ kind: 'constant-product', feePips: 3_000 })
    const asked = requests.flat()
    expect(asked).toContain(callOf(AERO_V2.volatileFactory, aeroPoolFactoryAbi, 'feeModule'))
    for (const pool of [stable, volatile]) {
      const to = pool.address as `0x${string}`
      expect(asked).not.toContain(callOf(to, aerodromePoolAbi, 'metadata'))
      expect(asked).not.toContain(callOf(to, aerodromePoolAbi, 'stable'))
    }
  })

  it('throws PoolConfigChangedError when the factory points at another fee module', async () => {
    const fixture = v2Fixture()
    registerAeroV2Factory(fixture, { volatileModule: addr(0xfee), blocks: [SECOND] })
    const { r } = reader(fixture)
    await expect(r.readState(stable, { bandPct: 5, blockNumber: SECOND })).resolves.toBeDefined()
    const error = await r
      .readState(volatile, { bandPct: 5, blockNumber: SECOND })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PoolConfigChangedError)
    expect(error).toMatchObject({ subject: volatile.id, change: 'fee module changed' })
    expect(String(error)).toContain(`${volatile.id}: fee module changed (${addr(0xfee)})`)
  })
})

describe('readState: aero-slipstream', () => {
  const pool = poolMeta({
    dex: 'aero-slipstream',
    address: addr(0xc601),
    token0: TOKEN_A,
    token1: TOKEN_D,
    feePips: 2_055,
    tickSpacing: 50,
  })
  const spec = (feePips: number) => ({
    sqrtPriceX96: 1n << 96n,
    tick: 0,
    liquidity: 10n ** 18n,
    feePips,
    tickSpacing: 50,
    // No initialized tick near the price: every word the walk reads is empty.
    bitmaps: { [-2]: 0n, [-1]: 0n, 0: 0n, 1: 0n },
    ticks: {},
  })

  function clFixture(hook: Parameters<typeof registerAeroCLPool>[3] = {}): Fixture {
    const fixture = fixtureAt()
    registerAeroCLPool(fixture, pool, spec(2_055), hook, [FIRST])
    registerAeroCLPool(fixture, pool, spec(645), hook, [SECOND])
    return fixture
  }

  it('uses the fee of each block and sends the hook guard with slot0 in the first request', async () => {
    const { r, requests } = reader(clFixture())
    const first = (await r.readState(pool, { bandPct: 1, blockNumber: FIRST })) as ConcentratedState
    const second = await r.readState(pool, { bandPct: 1, blockNumber: SECOND })
    expect([first.feePips, second.feePips]).toEqual([2_055, 645])
    const to = pool.address as `0x${string}`
    expect(requests[0]).toEqual([
      callOf(to, aerodromeCLPoolAbi, 'slot0'),
      callOf(to, aerodromeCLPoolAbi, 'liquidity'),
      callOf(to, aerodromeCLPoolAbi, 'fee'),
      callOf(to, aerodromeCLPoolAbi, 'tickSpacing'),
      callOf(AERO_CL.factory, aeroCLFactoryAbi, 'isPool'),
      callOf(AERO_CL.factory, aeroCLFactoryAbi, 'getPoolSwapHook'),
      callOf(AERO_CL.swapHook, aeroSwapHookAbi, 'dynamicFeeConfig'),
    ])
  })

  it('fails the read when the hook changed or the initial fee is on', async () => {
    const other = addr(0x4004)
    const changed = await reader(clFixture({ hook: other }))
      .r.readState(pool, { bandPct: 1, blockNumber: SECOND })
      .catch((e: unknown) => e)
    expect(isPoolConfigChangedError(changed)).toBe(true)
    expect(String(changed)).toContain(`${pool.id}: swap hook changed (${other})`)
    const initial = await reader(clFixture({ initialFeeEnabled: true }))
      .r.readState(pool, { bandPct: 1, blockNumber: SECOND })
      .catch((e: unknown) => e)
    expect(initial).toMatchObject({ change: 'initial fee enabled', subject: pool.id })
    const unknown = await reader(clFixture({ isPool: false }))
      .r.readState(pool, { bandPct: 1, blockNumber: SECOND })
      .catch((e: unknown) => e)
    expect(String(unknown)).toContain('no aero-slipstream factory reports it as its pool')
  })

  it('a hooked pool only needs its hook to stay the one it was discovered with', async () => {
    const hooked = { ...pool, hooks: AERO_CL.swapHook }
    const fixture = clFixture({ initialFeeEnabled: true })
    const state = await reader(fixture).r.readState(hooked, { bandPct: 1, blockNumber: SECOND })
    expect(state.feePips).toBe(645)
    const foreign = { ...pool, hooks: addr(0x4004) }
    const error = await reader(fixture)
      .r.readState(foreign, { bandPct: 1, blockNumber: SECOND })
      .catch((e: unknown) => e)
    expect(String(error)).toContain(`swap hook changed (${AERO_CL.swapHook})`)
  })
})
