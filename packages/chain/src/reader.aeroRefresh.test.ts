/**
 * `refreshPoolMetas`: stored Aero Slipstream pools outside the seeded pairs (found by log
 * discovery, `--pool` or a mandate) get their PoolMeta built again as discovery builds it, so a
 * swap hook or initial fee that changed since is stored (and the reverse: a pool whose initial fee
 * was turned off is no longer hooked). The stored creation block is kept; pools of other DEXes
 * and pools the factory does not report are left out.
 */
import type { Address, PoolMeta, TokenInfo } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { NATIVE_ETH_TOKEN, resolveAddresses, TOKENS } from './addresses.js'
import { setClock } from './fixtures/builders.js'
import { registerSeedWorld, type SeedWorldPool } from './fixtures/seedWorld.js'
import { createChainReader } from './reader.js'
import { AERO_CL } from './test/aeroHelpers.js'
import { addr, TOKEN_A } from './test/helpers.js'
import { createFixture, createFixtureTransport } from './transport/fixture.js'

const HEAD = 53_213_030n
const { WETH, USDC } = TOKENS
/** TOKEN_A pairs exist on chain but are not seeded: the reader's reference tokens leave it out. */
const READER = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC] })
const WORLD = resolveAddresses({ referenceTokens: [NATIVE_ETH_TOKEN, WETH, USDC, TOKEN_A] })

const CHANGED = addr(0xc801)
const TURNED_OFF = addr(0xc802)
const OTHER_HOOK = addr(0x4004)
const WORLD_POOLS: SeedWorldPool[] = [
  {
    dex: 'aero-slipstream',
    tokens: [WETH.address, TOKEN_A.address],
    tickSpacing: 100,
    address: CHANGED,
    createdAtBlock: 53_000_000n,
    liveFee: 2_055,
    swapHook: OTHER_HOOK,
  },
  {
    dex: 'aero-slipstream',
    tokens: [USDC.address, TOKEN_A.address],
    tickSpacing: 50,
    address: TURNED_OFF,
    createdAtBlock: 53_000_001n,
    liveFee: 465,
  },
]

/** A stored Aero Slipstream pool, as an earlier discovery wrote it. */
function stored(address: Address, a: TokenInfo, b: TokenInfo, tickSpacing: number): PoolMeta {
  const [token0, token1] = a.address < b.address ? [a, b] : [b, a]
  return {
    id: `aero-slipstream:${address}`,
    dex: 'aero-slipstream',
    kind: 'concentrated',
    address,
    poolId: null,
    token0,
    token1,
    feePips: 1,
    tickSpacing,
    stable: false,
    hooks: null,
    createdAtBlock: 7n,
  }
}

function reader() {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, { addresses: WORLD, pools: WORLD_POOLS })
  return createChainReader({ transport: createFixtureTransport(fixture), addresses: READER })
}

describe('refreshPoolMetas: Aero Slipstream pools outside the seeded pairs', () => {
  it('a seed does not find them, so it is what reads their hooks again', async () => {
    const seeded = await reader().seedPools({ dexes: ['aero-slipstream'] })
    expect(seeded.pools).toEqual([])
  })

  it('rebuilds hooks and fee from the chain and keeps the stored creation block', async () => {
    const changed = stored(CHANGED, WETH, TOKEN_A, 100)
    const turnedOff = { ...stored(TURNED_OFF, USDC, TOKEN_A, 50), hooks: AERO_CL.swapHook }
    const refreshed = await reader().refreshPoolMetas([changed, turnedOff])
    expect(refreshed).toEqual([
      { ...changed, feePips: 2_055, hooks: OTHER_HOOK },
      { ...turnedOff, feePips: 465, hooks: null },
    ])
  })

  it('leaves out other DEXes and a pool the factory does not report at that address', async () => {
    const elsewhere = stored(addr(0xc803), WETH, TOKEN_A, 100)
    const notAero: PoolMeta = {
      ...stored(CHANGED, WETH, TOKEN_A, 100),
      dex: 'aerodrome-slipstream',
    }
    expect(await reader().refreshPoolMetas([elsewhere, notAero])).toEqual([])
    expect(await reader().refreshPoolMetas([])).toEqual([])
  })
})
