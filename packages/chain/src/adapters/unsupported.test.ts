/**
 * The Aero DEX ids are defined in core before this package reads them: every read of their
 * adapters and seeders rejects with `DexNotSupportedError` naming the DEX, and their swaps already
 * share the scans of the DEX whose pools emit the same `Swap` event.
 */
import type { PoolMeta } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { TOKENS } from '../addresses.js'
import { setClock } from '../fixtures/builders.js'
import { swapScanOf } from '../internal/swapScans.js'
import { createChainReader } from '../reader.js'
import { SEEDERS } from '../seed/candidates.js'
import { createFixture, createFixtureTransport } from '../transport/fixture.js'
import { ADAPTERS } from './index.js'
import { DexNotSupportedError } from './unsupported.js'

const HEAD = 53_000_000n

function reader() {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: HEAD, latestTimestamp: 1_800_000_000 })
  return createChainReader({ transport: createFixtureTransport(fixture) })
}

const pool = (dex: 'aero-v2' | 'aero-slipstream'): PoolMeta => ({
  id: `${dex}:0x00000000000000000000000000000000000000a1`,
  dex,
  kind: dex === 'aero-v2' ? 'constant-product' : 'concentrated',
  address: '0x00000000000000000000000000000000000000a1',
  poolId: null,
  token0: TOKENS.WETH,
  token1: TOKENS.USDC,
  feePips: 3_000,
  tickSpacing: dex === 'aero-v2' ? null : 50,
  stable: false,
  hooks: null,
  createdAtBlock: 52_900_000n,
})

describe.each(['aero-v2', 'aero-slipstream'] as const)('%s before its adapter exists', (dex) => {
  it('rejects discovery, state and positions with DexNotSupportedError', async () => {
    const r = reader()
    await expect(r.discoverPools(dex, HEAD - 10n, HEAD)).rejects.toThrow(DexNotSupportedError)
    await expect(r.discoverPools(dex, HEAD - 10n, HEAD)).rejects.toThrow(
      `${dex}: discovery is not supported yet`,
    )
    await expect(r.readState(pool(dex), { bandPct: 5, blockNumber: HEAD })).rejects.toThrow(
      `${dex}: state is not supported yet`,
    )
    await expect(
      r.readPositions(pool(dex), { fromBlock: HEAD - 10n, toBlock: HEAD }),
    ).rejects.toThrow(`${dex}: positions is not supported yet`)
    expect(ADAPTERS[dex].dex).toBe(dex)
  })

  it('lists the DEX in failed when seeding, with no pools', async () => {
    const seeded = await reader().seedPools({ dexes: [dex] })
    expect(seeded.pools).toEqual([])
    expect(seeded.dexes).toEqual([])
    expect(seeded.failed).toEqual([{ dex, error: `${dex}: seeding is not supported yet` }])
    await expect(SEEDERS[dex](undefined as never, HEAD, [])).rejects.toBeInstanceOf(
      DexNotSupportedError,
    )
  })
})

describe('Aero swap scans', () => {
  it('joins the Aerodrome v2 and Uniswap v3 scans: three sources for six DEXes', () => {
    expect(swapScanOf('aero-v2')).toBe('aerodrome-v2')
    expect(swapScanOf('aero-slipstream')).toBe('uniswap-v3')
    expect(ADAPTERS['aero-v2'].swaps).toBe(ADAPTERS['aerodrome-v2'].swaps)
    expect(ADAPTERS['aero-slipstream'].swaps).toBe(ADAPTERS['aerodrome-slipstream'].swaps)
  })
})
