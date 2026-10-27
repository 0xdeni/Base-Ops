import {
  type ConcentratedState,
  computeDepth,
  DEXES,
  type PoolMeta,
  sqrtPriceX96ToPrice,
} from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { createChainReader } from '../reader.js'
import { createFixtureTransport } from '../transport/fixture.js'
import {
  createSyntheticFixture,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_GAUGES,
  SYNTHETIC_OWNERS,
  SYNTHETIC_POOL_IDS,
  SYNTHETIC_PRICES,
} from './synthetic.js'
import { syntheticWorld } from './syntheticWorld.js'

function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

describe('createSyntheticFixture', () => {
  const world = syntheticWorld()
  const fixture = createSyntheticFixture()
  const reader = createChainReader({ transport: createFixtureTransport(fixture) })
  const byId = new Map(world.pools.map((p) => [p.meta.id, p]))

  it('is deterministic and JSON-serialisable', () => {
    expect(stringify(createSyntheticFixture())).toBe(stringify(fixture))
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture)
    expect(fixture.clock?.latestBlock).toBe(SYNTHETIC_DEFAULTS.latestBlock.toString())
  })

  it('runs the whole pipeline offline: discover → overview → state → positions → swaps', async () => {
    const latest = await reader.getLatestBlock()
    expect(latest).toEqual({
      number: SYNTHETIC_DEFAULTS.latestBlock,
      timestamp: SYNTHETIC_DEFAULTS.latestTimestamp,
    })

    const discovered: PoolMeta[] = []
    for (const dex of DEXES)
      discovered.push(...(await reader.discoverPools(dex, 1n, latest.number)))
    expect(discovered).toHaveLength(6)
    expect(new Set(discovered.map((p) => p.id))).toEqual(new Set(byId.keys()))
    for (const pool of discovered) expect(pool).toEqual(byId.get(pool.id)?.meta)
    const symbols = new Set(discovered.flatMap((p) => [p.token0.symbol, p.token1.symbol]))
    expect(symbols).toEqual(new Set(['WETH', 'USDC', 'cbBTC', 'ETH', 'AERO', 'USDbC']))

    const views = await reader.readOverview(discovered)
    expect(views.map((v) => v.pool.id)).toEqual(discovered.map((p) => p.id))
    for (const view of views) {
      const pool = byId.get(view.pool.id)
      if (!pool) throw new Error('unknown pool')
      expect(view.blockNumber).toBe(latest.number)
      if (pool.kind === 'v2') {
        expect(view).toMatchObject({
          sqrtPriceX96: null,
          liquidity: null,
          reserve0: pool.reserve0,
          reserve1: pool.reserve1,
        })
      } else {
        expect(view.sqrtPriceX96).toBe(pool.state.sqrtPriceX96)
        expect(view.liquidity).toBe(pool.state.liquidity)
        if (pool.variant === 'v4') expect([view.reserve0, view.reserve1]).toEqual([0n, 0n])
        else expect([view.reserve0, view.reserve1]).toEqual([pool.reserve0, pool.reserve1])
        const price = sqrtPriceX96ToPrice(
          view.sqrtPriceX96 as bigint,
          pool.meta.token0.decimals,
          pool.meta.token1.decimals,
        )
        const expected =
          pool.meta.token1.symbol === 'cbBTC' ? 1 / SYNTHETIC_PRICES.CBBTC : SYNTHETIC_PRICES.ETH
        expect(Math.abs(price / expected - 1)).toBeLessThan(1e-3)
      }
    }

    for (const pool of discovered) {
      const synthetic = byId.get(pool.id)
      if (!synthetic) throw new Error('unknown pool')
      const state = await reader.readState(pool, { bandPct: 5 })
      expect(state.blockNumber).toBe(latest.number)
      expect(state.timestamp).toBe(latest.timestamp)
      if (synthetic.kind === 'v2') {
        expect(state.kind).toBe(pool.stable ? 'stable-swap' : 'constant-product')
        expect(state).toMatchObject({
          reserve0: synthetic.reserve0,
          reserve1: synthetic.reserve1,
          feePips: pool.feePips,
        })
      } else {
        const s = state as ConcentratedState
        const w = synthetic.state
        expect(s).toMatchObject({
          kind: 'concentrated',
          sqrtPriceX96: w.sqrtPriceX96,
          tick: w.tick,
          liquidity: w.liquidity,
          feePips: w.feePips,
          tickSpacing: w.tickSpacing,
        })
        expect(s.tickLowerBound).toBeLessThanOrEqual(w.tick - 1054)
        expect(s.tickUpperBound).toBeGreaterThanOrEqual(w.tick + 954)
        expect(s.ticks).toEqual(
          w.ticks.filter((t) => t.index >= s.tickLowerBound && t.index <= s.tickUpperBound),
        )
      }
      const depth = computeDepth(state, pool.token0.decimals, pool.token1.decimals)
      expect(depth.map((d) => d.pct)).toEqual([1, 2, 5])
      expect(depth[0]?.up.reached).toBe(true)
      expect(depth[0]?.down.reached).toBe(true)
      expect(depth[0]?.up.amountIn).toBeGreaterThan(0n)
    }

    const range = { fromBlock: latest.number - world.swapWindowBlocks, toBlock: latest.number }
    for (const pool of discovered) {
      const synthetic = byId.get(pool.id)
      if (!synthetic) throw new Error('unknown pool')
      const positions = await reader.readPositions(pool, range)
      if (synthetic.kind === 'v2') {
        expect(positions).toEqual([])
        continue
      }
      // The NFPM reports the holder: the CLGauge for the staked Slipstream position.
      const expected = synthetic.positions.map((p) => ({
        owner: p.holder,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidity: p.liquidity,
        tokenId: p.tokenId,
      }))
      expect(positions).toEqual(expected)
      // Resolving against the synthetic owners gives the depositors back; other pools are untouched.
      const resolved = await reader.resolveStakedOwners(pool, positions, SYNTHETIC_OWNERS)
      expect(resolved.map((p) => p.owner)).toEqual(synthetic.positions.map((p) => p.owner))
      if (synthetic.variant !== 'slipstream') expect(resolved).toEqual(positions)
    }

    const swaps = await reader.readSwaps(discovered, range.fromBlock, range.toBlock)
    const perPool = new Map<string, number>()
    for (const s of swaps) perPool.set(s.poolId, (perPool.get(s.poolId) ?? 0) + 1)
    for (const pool of world.pools) expect(perPool.get(pool.meta.id)).toBe(pool.swapCount)
    expect(swaps.length).toBe(world.pools.reduce((n, p) => n + p.swapCount, 0))
    for (let i = 1; i < swaps.length; i++) {
      const [a, b] = [swaps[i - 1]!, swaps[i]!]
      expect(
        a.blockNumber < b.blockNumber ||
          (a.blockNumber === b.blockNumber && a.logIndex <= b.logIndex),
      ).toBe(true)
    }
    const dayAgo = latest.timestamp - 86_400
    for (const s of swaps) {
      expect(s.timestamp).not.toBeNull()
      expect(s.timestamp as number).toBeGreaterThanOrEqual(dayAgo)
      expect(s.timestamp as number).toBeLessThanOrEqual(latest.timestamp)
      expect(s.timestamp).toBe(latest.timestamp - Number(latest.number - s.blockNumber) * 2)
      // Exactly one token flows into the pool per swap, for every DEX (v4 is sign-normalised).
      expect(s.amount0 > 0n !== s.amount1 > 0n).toBe(true)
    }
    const keys = new Set(swaps.map((s) => `${s.poolId}:${s.blockNumber}:${s.logIndex}`))
    expect(keys.size).toBe(swaps.length)
  })

  it('stakes the Slipstream [-300, 300] position of owner 1 in the CLGauge', async () => {
    const synthetic = byId.get(SYNTHETIC_POOL_IDS.wethUsdcSlipstream)
    if (synthetic?.kind !== 'concentrated') throw new Error('slipstream pool missing')
    const gauge = SYNTHETIC_GAUGES.wethUsdcSlipstream
    expect(synthetic.gauge).toBe(gauge)
    const staked = synthetic.positions.filter((p) => p.holder === gauge)
    expect(staked).toHaveLength(1)
    const aligned = synthetic.state.tick - (((synthetic.state.tick % 100) + 100) % 100)
    expect(staked[0]).toMatchObject({
      owner: SYNTHETIC_OWNERS[1],
      tickLower: aligned - 300,
      tickUpper: aligned + 300,
    })
    expect(synthetic.positions.filter((p) => p.holder !== p.owner)).toEqual(staked)
    const pool = synthetic.meta
    const latest = await reader.getLatestBlock()
    const positions = await reader.readPositions(pool, {
      fromBlock: latest.number - world.swapWindowBlocks,
      toBlock: latest.number,
    })
    const reported = positions.find((p) => p.tokenId === staked[0]?.tokenId)
    expect(reported?.owner).toBe(gauge)
    // Only candidates that staked the NFT resolve it; the gauge stays otherwise.
    const [bobOnly, aliceOnly] = await Promise.all([
      reader.resolveStakedOwners(pool, positions, [SYNTHETIC_OWNERS[1]!]),
      reader.resolveStakedOwners(pool, positions, [SYNTHETIC_OWNERS[0]!]),
    ])
    expect(bobOnly.find((p) => p.tokenId === reported?.tokenId)?.owner).toBe(SYNTHETIC_OWNERS[1])
    expect(aliceOnly.find((p) => p.tokenId === reported?.tokenId)?.owner).toBe(gauge)
    expect(bobOnly.filter((p) => p.tokenId !== reported?.tokenId)).toEqual(
      positions.filter((p) => p.tokenId !== reported?.tokenId),
    )
  })

  it('gives both Aerodrome v2 pools LP supply with owner 0 holding 40 % in wallet and 10 % staked', async () => {
    for (const [key, poolId] of [
      ['usdcAeroV2', SYNTHETIC_POOL_IDS.usdcAeroV2],
      ['usdcUsdbcV2', SYNTHETIC_POOL_IDS.usdcUsdbcV2],
    ] as const) {
      const synthetic = byId.get(poolId)
      if (synthetic?.kind !== 'v2') throw new Error(`${poolId} missing`)
      expect(synthetic.gauge).toBe(SYNTHETIC_GAUGES[key])
      expect(synthetic.lpTotalSupply).toBeGreaterThan(0n)
      const supply = synthetic.lpTotalSupply
      expect(synthetic.lpHoldings).toEqual([
        { owner: SYNTHETIC_OWNERS[0], balance: (supply * 40n) / 100n, staked: supply / 10n },
      ])
      const holdings = await reader.readLpHoldings(synthetic.meta, SYNTHETIC_OWNERS)
      expect(holdings).toEqual(
        SYNTHETIC_OWNERS.map((address, i) => ({
          address,
          balance: i === 0 ? (supply * 40n) / 100n : 0n,
          staked: i === 0 ? supply / 10n : 0n,
          totalSupply: supply,
        })),
      )
      const atBlock = await reader.readLpHoldings(
        synthetic.meta,
        [SYNTHETIC_OWNERS[0]!],
        SYNTHETIC_DEFAULTS.latestBlock,
      )
      expect(atBlock).toEqual([holdings[0]])
    }
  })

  it('accepts a custom clock', async () => {
    const fixture = createSyntheticFixture({
      latestBlock: 100_000n,
      latestTimestamp: 1_700_000_000,
    })
    const reader = createChainReader({ transport: createFixtureTransport(fixture) })
    expect(await reader.getLatestBlock()).toEqual({ number: 100_000n, timestamp: 1_700_000_000 })
    const pools = await reader.discoverPools('uniswap-v3', 1n, 100_000n)
    expect(pools).toHaveLength(2)
    const state = await reader.readState(pools[0]!, { bandPct: 5 })
    expect(state.blockNumber).toBe(100_000n)
    expect(state.timestamp).toBe(1_700_000_000)
  })
})
