/**
 * A mandate on a hooked Uniswap v4 pool: the pool is not modelled (docs/METRICS.md, `hooked`), so
 * every mandate on it is an attribution failure and gets no sample, never a within-KPI or breach
 * sample measured by the swap walk, even when the pool's positions are published. The same pool
 * without its hook is sampled.
 */
import { createChainReader, createFixture, createFixtureTransport } from '@depthwatch/chain'
import {
  type Address,
  buildConcentratedState,
  getTickAtSqrtRatio,
  type PoolMeta,
  priceToSqrtPriceX96,
  type TokenInfo,
} from '@depthwatch/core'
import { type Database, fixtureMandate, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { createPipelineContext, syncKeys } from './context.js'
import { HOOKED_NOT_MODELLED, sampleMandates } from './mm.js'

const token = (address: string, symbol: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
})
const WETH = token('0x4200000000000000000000000000000000000006', 'WETH', 18)
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6)
const POOL_ID = `0x${'cd'.repeat(32)}` as const

function v4Pool(hooks: Address | null): PoolMeta {
  return {
    id: `uniswap-v4:${POOL_ID}`,
    dex: 'uniswap-v4',
    kind: 'concentrated',
    address: null,
    poolId: POOL_ID,
    token0: WETH,
    token1: USDC,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks,
    createdAtBlock: 1n,
  }
}

/** WETH/USDC at $2,500 with liquidity in ±20 % of it. */
function stateAt2500() {
  const sqrtPriceX96 = priceToSqrtPriceX96(2500, 18, 6)
  const tick = getTickAtSqrtRatio(sqrtPriceX96)
  const aligned = Math.floor(tick / 10) * 10
  const state = buildConcentratedState({
    positions: [{ tickLower: aligned - 2_000, tickUpper: aligned + 2_000, liquidity: 10n ** 17n }],
    tick,
    feePips: 500,
    tickSpacing: 10,
    tickLowerBound: aligned - 4_000,
    tickUpperBound: aligned + 4_000,
  })
  return { ...state, sqrtPriceX96 }
}

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

async function sample(pool: PoolMeta) {
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  const lines: string[] = []
  const ctx = createPipelineContext({
    db,
    chain: createChainReader({ transport: createFixtureTransport(createFixture()) }),
    config: loadConfig({}),
    log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
  })
  // Positions are published for the pool (an empty set): only the hook stands in the way.
  db.syncState.setBigInt(syncKeys.positions(pool.id), 100n)
  const mandates = ['mm-a', 'mm-b'].map((id) => fixtureMandate({ id, poolId: pool.id }))
  const failures: Array<{ id: string; error: string }> = []
  const samples = await sampleMandates(ctx, {
    pool,
    state: stateAt2500(),
    prices: new Map([
      [WETH.address, { usd: 2500, via: [], weight: 0 }],
      [USDC.address, { usd: 1, via: [], weight: 0 }],
    ]),
    positions: null,
    blockNumber: 200n,
    timestamp: 1_700_000_000,
    mandates,
    onFailure: (id, error) => failures.push({ id, error }),
  })
  return { samples, failures, lines }
}

describe('sampleMandates on a hooked Uniswap v4 pool', () => {
  it('reports every mandate as an attribution failure and samples none', async () => {
    const { samples, failures, lines } = await sample(
      v4Pool('0x00000000000000000000000000000000000000c0'),
    )
    expect(samples).toEqual([])
    expect(failures).toEqual([
      { id: 'mm-a', error: HOOKED_NOT_MODELLED },
      { id: 'mm-b', error: HOOKED_NOT_MODELLED },
    ])
    expect(lines.some((line) => line.includes('hooked pool is not modelled'))).toBe(true)
  })

  it('samples the same pool without a hook', async () => {
    const { samples, failures } = await sample(v4Pool(null))
    expect(failures).toEqual([])
    expect(samples.map((s) => [s.mandateId, s.attribution.method])).toEqual([
      ['mm-a', 'none'],
      ['mm-b', 'none'],
    ])
  })
})
