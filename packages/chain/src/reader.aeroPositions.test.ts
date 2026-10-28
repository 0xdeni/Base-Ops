/**
 * Aero Slipstream positions and gauges: the Aero NFPM emits a 6-field `IncreaseLiquidity`
 * (topic0 0x0f8712c4…, docs/research/base-contracts.md §2.9), so a position whose liquidity was
 * only increased in the range is found through it, and a scan with the 4-field Slipstream ABI
 * misses it. Staked NFTs belong to the pool's CLGauge (`CLPool.gauge()`, a custodian) and resolve
 * to their depositor through `CLGauge.stakedContains`.
 */
import type { PoolMeta } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { aerodromeCLFactoryAbi } from './abi/aerodromeCLFactory.js'
import { aerodromeCLGaugeAbi } from './abi/aerodromeCLGauge.js'
import { aerodromeCLPoolAbi } from './abi/aerodromeCLPool.js'
import { aeroNFPMAbi } from './abi/aeroNFPM.js'
import { addLogs, makeLog, registerCall } from './fixtures/builders.js'
import { createChainReader } from './reader.js'
import { AERO_CL } from './test/aeroHelpers.js'
import {
  ALICE,
  addr,
  BOB,
  CAROL,
  newFixture,
  poolMeta,
  TOKEN_A,
  TOKEN_D,
  ZERO,
} from './test/helpers.js'
import { createFixtureTransport, type Fixture } from './transport/fixture.js'

const POOL = addr(0xc801)
const GAUGE = addr(0x6a07)
const NFPM = AERO_CL.positionManager
const pool = poolMeta({
  dex: 'aero-slipstream',
  address: POOL,
  token0: TOKEN_A,
  token1: TOKEN_D,
  feePips: 465,
  tickSpacing: 50,
})

/** Token 1 minted (Transfer + increase) at 100, then staked; token 2 minted at 100, increased at 1 050. */
function world(): Fixture {
  const fixture = newFixture()
  registerCall(fixture, {
    to: AERO_CL.factory,
    abi: aerodromeCLFactoryAbi,
    functionName: 'getPool',
    args: [TOKEN_A.address, TOKEN_D.address, 50],
    result: POOL,
  })
  const increase = (tokenId: bigint, liquidity: bigint, blockNumber: bigint, logIndex: number) =>
    makeLog({
      address: NFPM,
      abi: aeroNFPMAbi,
      eventName: 'IncreaseLiquidity',
      args: { tokenId, liquidity, amount0: 1n, amount1: 1n, tickLower: -100, tickUpper: 100 },
      blockNumber,
      logIndex,
    })
  const transfer = (from: `0x${string}`, to: `0x${string}`, tokenId: bigint, blockNumber: bigint) =>
    makeLog({
      address: NFPM,
      abi: aeroNFPMAbi,
      eventName: 'Transfer',
      args: { from, to, tokenId },
      blockNumber,
      logIndex: 0,
    })
  addLogs(fixture, [
    transfer(ZERO, ALICE, 1n, 100n),
    increase(1n, 500n, 100n, 1),
    transfer(ZERO, BOB, 2n, 100n),
    increase(2n, 300n, 100n, 2),
    transfer(ALICE, GAUGE, 1n, 200n),
    increase(2n, 400n, 1_050n, 0),
  ])
  for (const [tokenId, owner, liquidity] of [
    [1n, GAUGE, 500n],
    [2n, BOB, 700n],
  ] as const) {
    registerCall(fixture, {
      to: NFPM,
      abi: aeroNFPMAbi,
      functionName: 'positions',
      args: [tokenId],
      result: [
        0n,
        ZERO,
        TOKEN_A.address,
        TOKEN_D.address,
        50,
        -100,
        100,
        liquidity,
        0n,
        0n,
        0n,
        0n,
      ],
    })
    registerCall(fixture, {
      to: NFPM,
      abi: aeroNFPMAbi,
      functionName: 'ownerOf',
      args: [tokenId],
      result: owner,
    })
  }
  registerCall(fixture, { to: POOL, abi: aerodromeCLPoolAbi, functionName: 'gauge', result: GAUGE })
  for (const [depositor, staked] of [
    [ALICE, true],
    [CAROL, false],
  ] as const)
    registerCall(fixture, {
      to: GAUGE,
      abi: aerodromeCLGaugeAbi,
      functionName: 'stakedContains',
      args: [depositor, 1n],
      result: staked,
    })
  return fixture
}

const position = (owner: `0x${string}`, tokenId: bigint, liquidity: bigint) => ({
  owner,
  tickLower: -100,
  tickUpper: 100,
  liquidity,
  tokenId,
})

describe('readPositions: aero-slipstream', () => {
  it('finds a position only increased in the range through the 6-field IncreaseLiquidity', async () => {
    const r = createChainReader({
      transport: createFixtureTransport(world()),
      logChunkSize: 10_000,
    })
    expect(await r.readPositions(pool, { fromBlock: 1_000n, toBlock: 1_100n })).toEqual([
      position(BOB, 2n, 700n),
    ])
    expect(await r.readPositions(pool, { fromBlock: 1n, toBlock: 1_100n })).toEqual([
      position(GAUGE, 1n, 500n),
      position(BOB, 2n, 700n),
    ])
  })

  it('a scan with the 4-field Slipstream ABI over the same NFPM misses it', async () => {
    // The Aero deployment read as an Aerodrome one: the family scans with `slipstreamNFPMAbi`.
    const r = createChainReader({
      transport: createFixtureTransport(world()),
      logChunkSize: 10_000,
      addresses: { aerodromeSlipstream: [AERO_CL] },
    })
    const asAerodrome: PoolMeta = poolMeta({
      dex: 'aerodrome-slipstream',
      address: POOL,
      token0: TOKEN_A,
      token1: TOKEN_D,
      tickSpacing: 50,
    })
    expect(await r.readPositions(asAerodrome, { fromBlock: 1_000n, toBlock: 1_100n })).toEqual([])
  })

  it('reports the CLGauge as custodian and resolves its NFTs to their depositor', async () => {
    const r = createChainReader({
      transport: createFixtureTransport(world()),
      logChunkSize: 10_000,
    })
    expect(await r.readCustodians(pool)).toEqual([GAUGE])
    const positions = await r.readPositions(pool, { fromBlock: 1n, toBlock: 1_100n })
    expect(await r.resolveStakedOwners(pool, positions, [CAROL, ALICE])).toEqual([
      position(ALICE, 1n, 500n),
      position(BOB, 2n, 700n),
    ])
  })
})
