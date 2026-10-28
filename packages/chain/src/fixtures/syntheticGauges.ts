/**
 * Gauge side of the synthetic world (docs/design/scorecards.md §3): pool → gauge lookups (the
 * Aerodrome Voter; the Aero FactoryRegistry, as the LeafVoter has no pool views), LP-token supply
 * and balances of the v2 pools (pool `balanceOf`/`totalSupply`, v2 Gauge `balanceOf`), and the
 * Slipstream CLGauges (`CLPool.gauge()`, `stakedContains(depositor, tokenId)` for every synthetic
 * owner × position). Every synthetic owner is answerable, holders or not.
 */
import type { Address } from '@depthwatch/core'
import { aerodromeCLGaugeAbi } from '../abi/aerodromeCLGauge.js'
import { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import { aerodromeGaugeAbi } from '../abi/aerodromeGauge.js'
import { aerodromeVoterAbi } from '../abi/aerodromeVoter.js'
import { erc20Abi } from '../abi/erc20.js'
import type { ChainAddresses } from '../addresses.js'
import type { Fixture } from '../transport/fixture.js'
import { type BlockRef, registerCall } from './builders.js'
import { registerAeroV2Gauge } from './syntheticAero.js'
import {
  SYNTHETIC_OWNERS,
  type SyntheticConcentratedPool,
  type SyntheticV2Pool,
  type SyntheticWorld,
} from './syntheticTypes.js'

function worldBlocks(world: SyntheticWorld): BlockRef[] {
  return ['latest', world.latestBlock]
}

function registerVoterGauge(
  fixture: Fixture,
  addresses: ChainAddresses,
  pool: Address,
  gauge: Address,
  blocks: BlockRef[],
): void {
  registerCall(fixture, {
    to: addresses.aerodromeV2.voter,
    abi: aerodromeVoterAbi,
    functionName: 'gauges',
    args: [pool],
    result: gauge,
    blocks,
  })
  registerCall(fixture, {
    to: addresses.aerodromeV2.voter,
    abi: aerodromeVoterAbi,
    functionName: 'poolForGauge',
    args: [gauge],
    result: pool,
    blocks,
  })
  registerCall(fixture, {
    to: addresses.aerodromeV2.voter,
    abi: aerodromeVoterAbi,
    functionName: 'isAlive',
    args: [gauge],
    result: true,
    blocks,
  })
}

/** LP token (= pool) supply and balances, the pool's gauge and the gauge's staked balances. */
export function registerV2LpHoldings(
  fixture: Fixture,
  world: SyntheticWorld,
  pool: SyntheticV2Pool,
  addresses: ChainAddresses,
): void {
  const lpToken = pool.meta.address as Address
  const blocks = worldBlocks(world)
  const holdings = new Map(pool.lpHoldings.map((h) => [h.owner, h]))
  let stakedTotal = 0n
  for (const h of pool.lpHoldings) stakedTotal += h.staked
  registerCall(fixture, {
    to: lpToken,
    abi: erc20Abi,
    functionName: 'totalSupply',
    result: pool.lpTotalSupply,
    blocks,
  })
  if (pool.meta.dex === 'aero-v2') registerAeroV2Gauge(fixture, pool, addresses, blocks)
  else registerVoterGauge(fixture, addresses, lpToken, pool.gauge, blocks)
  registerCall(fixture, {
    to: pool.gauge,
    abi: aerodromeGaugeAbi,
    functionName: 'stakingToken',
    result: lpToken,
    blocks,
  })
  registerCall(fixture, {
    to: pool.gauge,
    abi: aerodromeGaugeAbi,
    functionName: 'totalSupply',
    result: stakedTotal,
    blocks,
  })
  // The gauge itself holds every staked LP token.
  registerCall(fixture, {
    to: lpToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [pool.gauge],
    result: stakedTotal,
    blocks,
  })
  for (const owner of SYNTHETIC_OWNERS) {
    const holding = holdings.get(owner)
    registerCall(fixture, {
      to: lpToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
      result: holding?.balance ?? 0n,
      blocks,
    })
    registerCall(fixture, {
      to: pool.gauge,
      abi: aerodromeGaugeAbi,
      functionName: 'balanceOf',
      args: [owner],
      result: holding?.staked ?? 0n,
      blocks,
    })
  }
}

/**
 * `CLPool.gauge()`, the Aerodrome Voter's view of it (Aero's LeafVoter has none), and
 * `stakedContains` for every owner × position.
 */
export function registerSlipstreamGauge(
  fixture: Fixture,
  world: SyntheticWorld,
  pool: SyntheticConcentratedPool,
  addresses: ChainAddresses,
): void {
  const gauge = pool.gauge
  if (gauge === null) return
  const address = pool.meta.address as Address
  const blocks = worldBlocks(world)
  registerCall(fixture, {
    to: address,
    abi: aerodromeCLPoolAbi,
    functionName: 'gauge',
    result: gauge,
    blocks,
  })
  if (pool.meta.dex === 'aerodrome-slipstream')
    registerVoterGauge(fixture, addresses, address, gauge, blocks)
  registerCall(fixture, {
    to: gauge,
    abi: aerodromeCLGaugeAbi,
    functionName: 'pool',
    result: address,
    blocks,
  })
  for (const owner of SYNTHETIC_OWNERS) {
    const staked = pool.positions.filter((p) => p.holder === gauge && p.owner === owner)
    registerCall(fixture, {
      to: gauge,
      abi: aerodromeCLGaugeAbi,
      functionName: 'stakedValues',
      args: [owner],
      result: staked.map((p) => p.tokenId),
      blocks,
    })
    for (const p of pool.positions)
      registerCall(fixture, {
        to: gauge,
        abi: aerodromeCLGaugeAbi,
        functionName: 'stakedContains',
        args: [owner, p.tokenId],
        result: p.holder === gauge && p.owner === owner,
        blocks,
      })
  }
}
