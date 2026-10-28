import type { Position } from '@depthwatch/core'
import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { aerodromeCLGaugeAbi } from './abi/aerodromeCLGauge.js'
import { aerodromeCLPoolAbi } from './abi/aerodromeCLPool.js'
import { aerodromeGaugeAbi } from './abi/aerodromeGauge.js'
import { aerodromeVoterAbi } from './abi/aerodromeVoter.js'
import { erc20Abi } from './abi/erc20.js'
import { BASE_ADDRESSES as A } from './addresses.js'
import { type BlockRef, registerCall, registerRevert } from './fixtures/builders.js'
import { type CreateChainReaderOptions, createChainReader } from './reader.js'
import {
  ALICE,
  addr,
  BOB,
  CAROL,
  countingTransport,
  findCause,
  newFixture,
  poolMeta,
  TOKEN_A,
  TOKEN_D,
  ZERO,
} from './test/helpers.js'
import { createFixtureTransport, type Fixture, FixtureMissError } from './transport/fixture.js'

function reader(fixture: Fixture, opts: CreateChainReaderOptions = {}) {
  const counts = new Map<string, number>()
  const r = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
    ...opts,
  })
  return { r, counts }
}

const GAUGE = addr(0x6a06e)

interface LpSpec {
  totalSupply: bigint
  gauge: `0x${string}`
  wallet: Record<`0x${string}`, bigint>
  staked?: Record<`0x${string}`, bigint>
  blocks?: BlockRef[]
}

/** Pool = LP token: totalSupply/balanceOf; Voter.gauges(pool); Gauge.balanceOf. */
function registerLp(fixture: Fixture, pool: `0x${string}`, spec: LpSpec): void {
  const blocks = spec.blocks ?? ['latest']
  registerCall(fixture, {
    to: pool,
    abi: erc20Abi,
    functionName: 'totalSupply',
    result: spec.totalSupply,
    blocks,
  })
  registerCall(fixture, {
    to: A.aerodromeV2.voter,
    abi: aerodromeVoterAbi,
    functionName: 'gauges',
    args: [pool],
    result: spec.gauge,
    blocks,
  })
  for (const [owner, balance] of Object.entries(spec.wallet))
    registerCall(fixture, {
      to: pool,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
      result: balance,
      blocks,
    })
  for (const [owner, balance] of Object.entries(spec.staked ?? {}))
    registerCall(fixture, {
      to: spec.gauge,
      abi: aerodromeGaugeAbi,
      functionName: 'balanceOf',
      args: [owner],
      result: balance,
      blocks,
    })
}

describe('readLpHoldings', () => {
  const v2 = poolMeta({
    dex: 'aerodrome-v2',
    address: addr(0x701),
    token0: TOKEN_A,
    token1: TOKEN_D,
  })

  it('aerodrome-v2 with a gauge: wallet + staked balances in two multicalls, lowercased and deduplicated', async () => {
    const fixture = newFixture()
    registerLp(fixture, v2.address as `0x${string}`, {
      totalSupply: 1_000n,
      gauge: GAUGE,
      wallet: { [ALICE]: 400n, [BOB]: 0n },
      staked: { [ALICE]: 100n, [BOB]: 50n },
    })
    const { r, counts } = reader(fixture)
    const holdings = await r.readLpHoldings(v2, [getAddress(ALICE), BOB, ALICE])
    expect(holdings).toEqual([
      { address: ALICE, balance: 400n, staked: 100n, totalSupply: 1_000n },
      { address: BOB, balance: 0n, staked: 50n, totalSupply: 1_000n },
    ])
    expect(counts.get('eth_call')).toBe(2)
    expect(counts.get('eth_getBlockByNumber')).toBeUndefined()
  })

  it('aerodrome-v2 without a gauge: staked is 0n and the gauge is never read', async () => {
    const fixture = newFixture()
    registerLp(fixture, v2.address as `0x${string}`, {
      totalSupply: 10n ** 18n,
      gauge: ZERO,
      wallet: { [CAROL]: 123n },
    })
    const { r, counts } = reader(fixture)
    expect(await r.readLpHoldings(v2, [CAROL])).toEqual([
      { address: CAROL, balance: 123n, staked: 0n, totalSupply: 10n ** 18n },
    ])
    expect(counts.get('eth_call')).toBe(1)
  })

  it('reads at the given block', async () => {
    const fixture = newFixture()
    registerLp(fixture, v2.address as `0x${string}`, {
      totalSupply: 500n,
      gauge: GAUGE,
      wallet: { [ALICE]: 5n },
      staked: { [ALICE]: 7n },
      blocks: [777n],
    })
    const { r } = reader(fixture)
    expect(await r.readLpHoldings(v2, [ALICE], 777n)).toEqual([
      { address: ALICE, balance: 5n, staked: 7n, totalSupply: 500n },
    ])
    const miss = await r.readLpHoldings(v2, [ALICE]).catch((e) => e)
    expect(findCause(miss, (e) => e instanceof FixtureMissError)).toBeDefined()
  })

  it('rejects other DEX kinds and reads nothing for an empty address list', async () => {
    const { r, counts } = reader(newFixture())
    const v3 = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x702),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    const slip = poolMeta({
      dex: 'aerodrome-slipstream',
      address: addr(0x703),
      token0: TOKEN_A,
      token1: TOKEN_D,
      tickSpacing: 100,
    })
    const v4 = poolMeta({ dex: 'uniswap-v4', token0: TOKEN_A, token1: TOKEN_D })
    for (const pool of [v3, slip, v4])
      await expect(r.readLpHoldings(pool, [ALICE])).rejects.toThrow(/no fungible LP token/)
    expect(await r.readLpHoldings(v2, [])).toEqual([])
    expect(counts.size).toBe(0)
  })
})

describe('resolveStakedOwners', () => {
  const slip = poolMeta({
    dex: 'aerodrome-slipstream',
    address: addr(0x710),
    token0: TOKEN_A,
    token1: TOKEN_D,
    feePips: 500,
    tickSpacing: 100,
  })
  const position = (owner: `0x${string}`, tokenId: bigint | null, lower = -100): Position => ({
    owner,
    tickLower: lower,
    tickUpper: lower + 200,
    liquidity: 1_000n,
    tokenId,
  })
  const registerGauge = (fixture: Fixture, gauge: `0x${string}`, blocks: BlockRef[] = ['latest']) =>
    registerCall(fixture, {
      to: slip.address as `0x${string}`,
      abi: aerodromeCLPoolAbi,
      functionName: 'gauge',
      result: gauge,
      blocks,
    })
  const stakedContains = (
    fixture: Fixture,
    depositor: `0x${string}`,
    tokenId: bigint,
    result: boolean,
  ) =>
    registerCall(fixture, {
      to: GAUGE,
      abi: aerodromeCLGaugeAbi,
      functionName: 'stakedContains',
      args: [depositor, tokenId],
      result,
    })

  it('aerodrome-slipstream: gauge-owned positions become their depositor, everything else passes through', async () => {
    const fixture = newFixture()
    registerGauge(fixture, GAUGE)
    const [alice, g1, g2, g3, carol] = [
      position(ALICE, 1n),
      position(GAUGE, 2n, -300),
      position(GAUGE, 3n, 0),
      position(GAUGE, null, 100),
      position(CAROL, 4n),
    ]
    const input = [alice, g1, g2, g3, carol]
    stakedContains(fixture, BOB, 2n, true)
    stakedContains(fixture, CAROL, 2n, false)
    registerRevert(fixture, {
      to: GAUGE,
      abi: aerodromeCLGaugeAbi,
      functionName: 'stakedContains',
      args: [ALICE, 2n],
    })
    stakedContains(fixture, BOB, 3n, false)
    stakedContains(fixture, CAROL, 3n, true)
    stakedContains(fixture, ALICE, 3n, true) // second match: ignored, first candidate wins
    const { r, counts } = reader(fixture)
    const out = await r.resolveStakedOwners(slip, input, [getAddress(BOB), CAROL, ALICE, BOB])
    expect(out).toEqual([alice, { ...g1, owner: BOB }, { ...g2, owner: CAROL }, g3, carol])
    expect(out[0]).toBe(alice)
    expect(out[3]).toBe(g3)
    expect(out[4]).toBe(carol)
    expect(g1.owner).toBe(GAUGE) // input untouched
    expect(counts.get('eth_call')).toBe(2) // gauge(), then every stakedContains in one multicall
    expect(counts.get('eth_getBlockByNumber')).toBeUndefined()
  })

  it('aerodrome-slipstream: a gauge-owned position no candidate staked keeps the gauge as owner', async () => {
    const fixture = newFixture()
    registerGauge(fixture, GAUGE)
    stakedContains(fixture, ALICE, 9n, false)
    const staked = position(GAUGE, 9n)
    const { r } = reader(fixture)
    expect(await r.resolveStakedOwners(slip, [staked], [ALICE])).toEqual([staked])
  })

  it('aerodrome-slipstream: no gauge, or no gauge-owned position, means a single read', async () => {
    const fixture = newFixture()
    registerGauge(fixture, ZERO)
    const input = [position(ALICE, 1n), position(GAUGE, 2n)]
    const { r, counts } = reader(fixture)
    const out = await r.resolveStakedOwners(slip, input, [BOB])
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(counts.get('eth_call')).toBe(1)
    registerGauge(fixture, GAUGE)
    expect(await r.resolveStakedOwners(slip, [position(ALICE, 1n)], [BOB])).toEqual([
      position(ALICE, 1n),
    ])
    expect(counts.get('eth_call')).toBe(2)
  })

  it('aerodrome-slipstream: reads nothing without positions or candidates, and honours blockNumber', async () => {
    const fixture = newFixture()
    const { r, counts } = reader(fixture)
    expect(await r.resolveStakedOwners(slip, [], [ALICE])).toEqual([])
    const input = [position(GAUGE, 1n)]
    expect(await r.resolveStakedOwners(slip, input, [])).toEqual(input)
    expect(counts.size).toBe(0)
    registerGauge(fixture, ZERO, [900n])
    expect(await r.resolveStakedOwners(slip, input, [ALICE], 900n)).toEqual(input)
    const miss = await r.resolveStakedOwners(slip, input, [ALICE]).catch((e) => e)
    expect(findCause(miss, (e) => e instanceof FixtureMissError)).toBeDefined()
  })

  it('non-Slipstream pools return the positions unchanged without any request', async () => {
    const { r, counts } = reader(newFixture())
    const pools = [
      poolMeta({ dex: 'uniswap-v3', address: addr(0x711), token0: TOKEN_A, token1: TOKEN_D }),
      poolMeta({ dex: 'uniswap-v4', token0: TOKEN_A, token1: TOKEN_D }),
      poolMeta({ dex: 'aerodrome-v2', address: addr(0x712), token0: TOKEN_A, token1: TOKEN_D }),
    ]
    const input = [position(GAUGE, 1n), position(ALICE, 2n)]
    for (const pool of pools) {
      const out = await r.resolveStakedOwners(pool, input, [BOB, ALICE])
      expect(out).toEqual(input)
      expect(out).not.toBe(input)
      expect(out[0]).toBe(input[0])
    }
    expect(counts.size).toBe(0)
  })

  it('readCustodians: the Slipstream gauge (lowercase), [] without one or on another DEX', async () => {
    const fixture = newFixture()
    registerGauge(fixture, getAddress(GAUGE) as `0x${string}`, [900n])
    registerGauge(fixture, ZERO, [901n])
    const { r, counts } = reader(fixture)
    expect(await r.readCustodians(slip, 900n)).toEqual([GAUGE])
    expect(await r.readCustodians(slip, 901n)).toEqual([])
    expect(counts.get('eth_call')).toBe(2)
    const v3 = poolMeta({
      dex: 'uniswap-v3',
      address: addr(0x711),
      token0: TOKEN_A,
      token1: TOKEN_D,
    })
    expect(await r.readCustodians(v3)).toEqual([])
    expect(counts.get('eth_call')).toBe(2)
  })
})
