/**
 * Aero v2 LP holdings: the pool is the LP token and its gauge comes from
 * `FactoryRegistry.targetToGauge(pool)` (0x800eb395… → 0x1d12ef78… on Base, and 0 for the stable
 * WETH/USDC pool: docs/research/base-contracts.md, `## aero`). The LeafVoter has no pool views,
 * so the Aerodrome Voter is never asked; a pool without a gauge stakes nothing and no gauge is read.
 */
import { describe, expect, it } from 'vitest'
import { aerodromeVoterAbi } from './abi/aerodromeVoter.js'
import { aeroFactoryRegistryAbi } from './abi/aeroFactoryRegistry.js'
import { erc20Abi } from './abi/erc20.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { registerCall } from './fixtures/builders.js'
import { createChainReader } from './reader.js'
import { AERO_V2, callOf, callRecorder, registerAeroGauge } from './test/aeroHelpers.js'
import { ALICE, addr, BOB, newFixture, poolMeta, TOKEN_A, TOKEN_D, ZERO } from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

const GAUGE = addr(0x6a08)

const lpPool = (address: `0x${string}`) =>
  poolMeta({ dex: 'aero-v2', address, token0: TOKEN_A, token1: TOKEN_D })

function registerLp(fixture: Fixture, pool: `0x${string}`, wallet: Record<string, bigint>): void {
  registerCall(fixture, { to: pool, abi: erc20Abi, functionName: 'totalSupply', result: 1_000n })
  for (const [owner, balance] of Object.entries(wallet))
    registerCall(fixture, {
      to: pool,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
      result: balance,
    })
}

function reader(fixture: Fixture) {
  const { transport, requests } = callRecorder(createFixtureTransport(fixture))
  return { r: createChainReader({ transport }), requests }
}

describe('readLpHoldings: aero-v2', () => {
  it('reads the gauge from the FactoryRegistry and the staked balances from it', async () => {
    const pool = lpPool(addr(0xa501))
    const fixture = newFixture()
    registerLp(fixture, pool.address as `0x${string}`, { [ALICE]: 100n, [BOB]: 0n })
    registerAeroGauge(fixture, pool.address as `0x${string}`, GAUGE, { [ALICE]: 50n, [BOB]: 25n })
    const { r, requests } = reader(fixture)
    expect(await r.readLpHoldings(pool, [ALICE, BOB])).toEqual([
      { address: ALICE, balance: 100n, staked: 50n, totalSupply: 1_000n },
      { address: BOB, balance: 0n, staked: 25n, totalSupply: 1_000n },
    ])
    expect(requests).toHaveLength(2) // wallet reads with the lookup, then the gauge balances
    expect(requests[0]).toContain(
      callOf(AERO_V2.factoryRegistry, aeroFactoryRegistryAbi, 'targetToGauge'),
    )
    expect(requests.flat()).not.toContain(callOf(A.aerodromeV2.voter, aerodromeVoterAbi, 'gauges'))
  })

  it('stakes nothing and reads no gauge when the registry has none', async () => {
    const pool = lpPool(addr(0xa502))
    const fixture = newFixture()
    registerLp(fixture, pool.address as `0x${string}`, { [ALICE]: 7n })
    registerAeroGauge(fixture, pool.address as `0x${string}`, ZERO)
    const { r, requests } = reader(fixture)
    expect(await r.readLpHoldings(pool, [ALICE])).toEqual([
      { address: ALICE, balance: 7n, staked: 0n, totalSupply: 1_000n },
    ])
    expect(requests).toHaveLength(1)
  })

  it('reports no custodians and leaves positions to the Slipstream DEXes', async () => {
    const pool = lpPool(addr(0xa503))
    const { r, requests } = reader(newFixture())
    expect(await r.readCustodians(pool)).toEqual([])
    expect(await r.readPositions(pool, { fromBlock: 1n, toBlock: 10n })).toEqual([])
    expect(requests).toEqual([])
  })
})
