/**
 * Market-maker sampling inside the snapshot step and on demand, over the synthetic Base world:
 * the two demo mandates get their samples (`ok` for the gauge-staked Slipstream position,
 * `breached` for the Aerodrome v2 LP share), an unknown pool never fails the snapshot, missing
 * positions yield method `none`, a failed gauge-staked resolution skips the mandates it concerns
 * (never a false `noLiquidity` breach), and `mm sample` reproduces the hook without a snapshot row.
 */

import type { ChainReader } from '@depthwatch/chain'
import { SYNTHETIC_GAUGES, SYNTHETIC_OWNERS, SYNTHETIC_POOL_IDS } from '@depthwatch/chain'
import {
  type Address,
  DEFAULT_MANDATE_KPIS,
  type Mandate,
  type MmSample,
  type PoolMeta,
} from '@depthwatch/core'
import { type Database, fixtureMandate, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain, DEMO_MANDATES, registerDemoMandates } from '../demo.js'
import { createLogger } from '../log.js'
import { createPipelineContext, type PipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { mmSampleStep, sampleMandates, storedPositions, storedPriceMap } from './mm.js'
import { positionsStep } from './positions.js'
import { type SnapshotResult, snapshotStep } from './snapshot.js'

const SLIPSTREAM = SYNTHETIC_POOL_IDS.wethUsdcSlipstream
const AERO = SYNTHETIC_POOL_IDS.usdcAeroV2
const UNKNOWN_POOL = 'uniswap-v3:0x00000000000000000000000000000000000000ff'

interface World {
  db: Database
  ctx: PipelineContext
  /** The same world one block later, where `mm sample` finds a block not sampled yet. */
  later: PipelineContext
  lines: string[]
  mandates: Mandate[]
  snapshot: SnapshotResult
}

/** The demo chain with `resolveStakedOwners` failing, as on an RPC timeout. */
function withFailingStakedOwners(chain: ChainReader): ChainReader {
  return {
    ...chain,
    resolveStakedOwners: () => Promise.reject(new Error('RPC timeout')),
  }
}

/** discover → positions → snapshot with only the mandated pools tracked (`--top 0`). */
async function buildWorld(
  extraMandates: Mandate[] = [],
  wrapChain: (chain: ChainReader) => ChainReader = (chain) => chain,
): Promise<World> {
  const db = openDatabase(IN_MEMORY)
  const chain = wrapChain(createDemoChain())
  const latest = await chain.getLatestBlock()
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const ctx = createPipelineContext({
    db,
    chain,
    config: loadConfig({}, { top: '0' }),
    log,
    now: () => latest.timestamp,
  })
  const mandates = registerDemoMandates(db, latest.timestamp)
  db.mandates.upsertMany(extraMandates)
  await discoverStep(ctx)
  await positionsStep(ctx, { pools: db.pools.list() })
  const snapshot = await snapshotStep(ctx)
  const next = createDemoChain({
    latestBlock: latest.number + 1n,
    latestTimestamp: latest.timestamp + 2,
  })
  return { db, ctx, later: { ...ctx, chain: wrapChain(next) }, lines, mandates, snapshot }
}

describe('sampling inside snapshotStep (demo mandates)', () => {
  let world: World
  const latestOf = (id: string): MmSample => {
    const sample = world.db.mmSamples.latestFor(id)
    if (sample === undefined) throw new Error(`no sample for ${id}`)
    return sample
  }

  beforeAll(async () => {
    world = await buildWorld()
  }, 20_000)
  afterAll(() => world.db.close())

  it('tracks the mandated pools whatever their rank and samples each mandate once', () => {
    expect(world.snapshot.tracked).toBe(2)
    expect(world.db.pools.trackedIds().sort()).toEqual([AERO, SLIPSTREAM].sort())
    expect(world.snapshot.snapshots).toBe(2)
    expect(world.snapshot.samples).toBe(2)
    expect(world.snapshot.sampleFailures).toBe(0)
    expect(world.snapshot.failed).toEqual([])
    expect(world.snapshot.alerts).toBe(0)
    for (const mandate of world.mandates) expect(world.db.mmSamples.countFor(mandate.id)).toBe(1)
  })

  it('samples share the block and timestamp of the pool snapshot', () => {
    for (const mandate of world.mandates) {
      const sample = latestOf(mandate.id)
      const snapshot = world.db.snapshots.latestForPool(mandate.poolId)
      expect(sample.poolId).toBe(mandate.poolId)
      expect(sample.blockNumber).toBe(snapshot?.blockNumber)
      expect(sample.timestamp).toBe(snapshot?.timestamp)
      expect(sample.blockNumber).toBe(world.snapshot.blockNumber)
    }
  })

  it('attributes the gauge-staked Slipstream position to its depositor: within KPI', () => {
    const mandate = world.mandates.find((m) => m.id === 'demo-slipstream-weth-usdc') as Mandate
    const sample = latestOf(mandate.id)
    // The stored position still names the gauge as owner; attribution resolved the depositor.
    const stored = world.db.positions.forPool(SLIPSTREAM)
    expect(stored.some((p) => p.owner === SYNTHETIC_GAUGES.wethUsdcSlipstream)).toBe(true)
    expect(stored.some((p) => p.owner === SYNTHETIC_OWNERS[1])).toBe(false)
    expect(sample.attribution.method).toBe('positions')
    expect(sample.attribution.holdings).toBe(1)
    expect(sample.attribution.shareOfPool ?? 0).toBeGreaterThan(0)
    expect(sample.attribution.shareOfPool ?? 1).toBeLessThan(1)
    expect(sample.attribution.depthUpUsd ?? 0).toBeGreaterThan(mandate.kpis.minDepthUsd)
    expect(sample.attribution.depthDownUsd ?? 0).toBeGreaterThan(mandate.kpis.minDepthUsd)
    expect(sample.attribution.depthUpUsd ?? 0).toBeLessThan(sample.attribution.poolDepthUpUsd ?? 0)
    expect(sample.attribution.spreadBps).not.toBeNull()
    expect(sample.withinKpi).toBe(true)
    expect(sample.breaches).toEqual([])
  })

  it('scales the AERO pool by the LP share (wallet + staked = 50 %): breached', () => {
    const mandate = world.mandates.find((m) => m.id === 'demo-aero-usdc-aero') as Mandate
    const sample = latestOf(mandate.id)
    expect(sample.attribution.method).toBe('lp-share')
    expect(sample.attribution.holdings).toBe(1)
    expect(sample.attribution.shareOfPool).toBeCloseTo(0.5, 6)
    expect(sample.attribution.depthUpUsd).toBeCloseTo(
      (sample.attribution.poolDepthUpUsd ?? 0) / 2,
      0,
    )
    expect(sample.attribution.depthDownUsd ?? 0).toBeLessThan(mandate.kpis.minDepthUsd)
    expect(sample.withinKpi).toBe(false)
    expect(sample.breaches).toEqual(['depthUp', 'depthDown'])
  })

  it('reports no-data as 0 holdings when the registered address owns nothing in the pool', async () => {
    const pool = world.db.pools.get(SLIPSTREAM)
    if (pool === undefined) throw new Error('pool missing')
    const stranger = fixtureMandate({
      id: 'stranger',
      poolId: SLIPSTREAM,
      addresses: ['0x00000000000000000000000000000000000000ee'],
      kpis: { minDepthUsd: 1, ...DEFAULT_MANDATE_KPIS },
    })
    const state = await world.ctx.chain.readState(pool, { bandPct: 5 })
    // The synthetic gauge only answers `stakedContains` for the synthetic owners; a real gauge
    // answers false for every token of a stranger, i.e. the staked positions stay with the gauge.
    const ctx: PipelineContext = {
      ...world.ctx,
      chain: {
        ...world.ctx.chain,
        resolveStakedOwners: async (_pool, positions) => [...positions],
      },
    }
    const [sample] = await sampleMandates(ctx, {
      pool,
      state,
      prices: storedPriceMap(world.db),
      positions: storedPositions(world.db, pool),
      blockNumber: state.blockNumber,
      timestamp: state.timestamp,
      mandates: [stranger],
    })
    expect(sample).toMatchObject({
      mandateId: 'stranger',
      withinKpi: false,
      breaches: ['noLiquidity', 'depthUp', 'depthDown'],
    })
    expect(sample?.attribution).toMatchObject({
      method: 'positions',
      holdings: 0,
      depthUpUsd: 0,
      depthDownUsd: 0,
      spreadBps: null,
      shareOfPool: 0,
    })
  })

  it('uses method none when a concentrated pool has no stored positions', async () => {
    const pool = world.db.pools.get(SLIPSTREAM)
    if (pool === undefined) throw new Error('pool missing')
    const mandate = world.mandates[0] as Mandate
    const state = await world.ctx.chain.readState(pool, { bandPct: 5 })
    const [sample] = await sampleMandates(world.ctx, {
      pool,
      state,
      prices: storedPriceMap(world.db),
      positions: null,
      blockNumber: state.blockNumber,
      timestamp: state.timestamp,
      mandates: [mandate],
    })
    expect(sample?.attribution.method).toBe('none')
    expect(sample?.attribution.holdings).toBe(0)
    expect(sample?.attribution.poolDepthUpUsd ?? 0).toBeGreaterThan(0)
    expect(sample?.withinKpi).toBe(false)
    expect(sample?.breaches).toContain('noLiquidity')
  })

  it('logs and skips a mandate whose attribution throws, keeping the others', async () => {
    const pool = world.db.pools.get(AERO)
    if (pool === undefined) throw new Error('pool missing')
    const [good, bad] = [
      world.mandates.find((m) => m.id === 'demo-aero-usdc-aero') as Mandate,
      fixtureMandate({ id: 'broken', poolId: AERO, addresses: [`0x${'ab'.repeat(20)}`] }),
    ]
    const state = await world.ctx.chain.readState(pool, { bandPct: 5 })
    const failures: string[] = []
    const samples = await sampleMandates(world.ctx, {
      pool,
      state,
      prices: storedPriceMap(world.db),
      positions: null,
      blockNumber: state.blockNumber,
      timestamp: state.timestamp,
      mandates: [bad, good],
      onFailure: (id) => failures.push(id),
    })
    // The fixture answers balanceOf only for the synthetic owners: the unknown address throws.
    expect(failures).toEqual(['broken'])
    expect(samples.map((s) => s.mandateId)).toEqual([good.id])
    expect(world.lines.some((l) => l.includes('attribution failed') && l.includes('broken'))).toBe(
      true,
    )
  })

  /** Samples the Slipstream pool for `mandates` through `ctx`, collecting the failures. */
  async function sampleSlipstream(
    ctx: PipelineContext,
    mandates: Mandate[],
  ): Promise<{ samples: MmSample[]; failures: Array<{ id: string; error: string }> }> {
    const pool = world.db.pools.get(SLIPSTREAM) as PoolMeta
    const state = await ctx.chain.readState(pool, { bandPct: 5 })
    const failures: Array<{ id: string; error: string }> = []
    const samples = await sampleMandates(ctx, {
      pool,
      state,
      prices: storedPriceMap(world.db),
      positions: storedPositions(world.db, pool),
      blockNumber: state.blockNumber,
      timestamp: state.timestamp,
      mandates,
      onFailure: (id, error) => failures.push({ id, error }),
    })
    return { samples, failures }
  }

  it('skips a Slipstream mandate whose staked positions cannot be resolved (no false breach)', async () => {
    const mandate = world.mandates.find((m) => m.id === 'demo-slipstream-weth-usdc') as Mandate
    const ctx = { ...world.ctx, chain: withFailingStakedOwners(world.ctx.chain) }
    const { samples, failures } = await sampleSlipstream(ctx, [mandate])
    expect(samples).toEqual([])
    expect(failures).toEqual([{ id: mandate.id, error: 'resolveStakedOwners failed: RPC timeout' }])
    expect(
      world.lines.some((l) => l.includes('attribution failed') && l.includes(mandate.id)),
    ).toBe(true)
  })

  it('resolves per mandate when the pooled read fails, so the failure stays with its mandate', async () => {
    const mandate = world.mandates.find((m) => m.id === 'demo-slipstream-weth-usdc') as Mandate
    // The fixture cannot answer `stakedContains` for this address: the read for the union of
    // both mandates' addresses fails, the demo mandate's own read does not.
    const stranger = fixtureMandate({
      id: 'stranger',
      poolId: SLIPSTREAM,
      addresses: ['0x00000000000000000000000000000000000000ee'],
    })
    const { samples, failures } = await sampleSlipstream(world.ctx, [mandate, stranger])
    expect(failures.map((f) => f.id)).toEqual(['stranger'])
    expect(failures[0]?.error).toMatch(/^resolveStakedOwners failed: /)
    expect(samples.map((s) => s.mandateId)).toEqual([mandate.id])
    expect(samples[0]).toMatchObject({ withinKpi: true, breaches: [] })
    expect(samples[0]?.attribution).toMatchObject({ method: 'positions', holdings: 1 })
    expect(
      world.lines.some((l) =>
        l.includes('resolveStakedOwners failed for the pool; resolving per mandate'),
      ),
    ).toBe(true)
  })

  it('mm sample re-samples every active mandate at the latest block without a snapshot row', async () => {
    const before = world.db.snapshots.count()
    // At the snapshot's own block every pool has its snapshot and every mandate its sample
    // already: a second pass there (another process) stores nothing.
    expect(await snapshotStep(world.ctx)).toMatchObject({ snapshots: 0, samples: 0, failed: [] })
    const same = await mmSampleStep(world.ctx)
    expect(same).toMatchObject({ mandates: 2, pools: 2, samples: 0, failed: [] })
    const result = await mmSampleStep(world.later)
    expect(result).toMatchObject({ mandates: 2, pools: 2, samples: 2, failed: [] })
    expect(result.blockNumber).toBe(world.snapshot.blockNumber + 1n)
    expect(result.alerts.attempts).toBe(0)
    expect(world.db.snapshots.count()).toBe(before)
    for (const mandate of world.mandates) {
      expect(world.db.mmSamples.countFor(mandate.id)).toBe(2)
      const again = latestOf(mandate.id)
      const first = world.db.mmSamples.seriesFor(mandate.id, 0)[0]
      expect(again.withinKpi).toBe(first?.withinKpi)
      expect(again.attribution).toEqual(first?.attribution)
    }
  })

  it('mm sample warns when nothing is active', async () => {
    for (const mandate of world.mandates) world.db.mandates.setActive(mandate.id, false)
    try {
      const result = await mmSampleStep(world.ctx)
      expect(result).toMatchObject({ mandates: 0, pools: 0, samples: 0 })
      expect(world.lines.some((l) => l.includes('no active mandates'))).toBe(true)
    } finally {
      for (const mandate of world.mandates) world.db.mandates.setActive(mandate.id, true)
    }
  })
})

describe('mandates on pools the database does not know', () => {
  it('snapshot logs and skips them; mm sample reports them as failed', async () => {
    const orphan = fixtureMandate({ id: 'orphan-pool', poolId: UNKNOWN_POOL })
    const world = await buildWorld([orphan])
    try {
      expect(world.snapshot.failed).toEqual([])
      expect(world.snapshot.tracked).toBe(2)
      expect(world.snapshot.samples).toBe(2)
      expect(world.db.mmSamples.countFor(orphan.id)).toBe(0)
      expect(
        world.lines.some(
          (l) => l.includes('mandate pool not in the database') && l.includes('orphan-pool'),
        ),
      ).toBe(true)
      const sampled = await mmSampleStep(world.later)
      expect(sampled.mandates).toBe(3)
      expect(sampled.pools).toBe(2)
      expect(sampled.samples).toBe(2)
      expect(sampled.failed).toEqual([
        { item: 'orphan-pool', error: `unknown pool "${UNKNOWN_POOL}"` },
      ])
    } finally {
      world.db.close()
    }
  }, 20_000)

  it('the demo registrations name the synthetic pools and owners', () => {
    expect(DEMO_MANDATES.map((m) => m.id)).toEqual([
      'demo-slipstream-weth-usdc',
      'demo-aero-usdc-aero',
    ])
    expect(DEMO_MANDATES[0]?.addresses).toEqual([SYNTHETIC_OWNERS[1]])
    expect(DEMO_MANDATES[1]?.addresses).toEqual([SYNTHETIC_OWNERS[0]])
    expect(DEMO_MANDATES.every((m) => m.alertWebhookUrl === undefined)).toBe(true)
    expect(DEMO_MANDATES.every((m) => m.kpis.maxSpreadBps === undefined)).toBe(true)
  })
})

describe('a failing resolveStakedOwners in the pipeline', () => {
  const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchSpy.mockClear()
  })

  it('stores no breach sample and posts no alert for the Slipstream mandates', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    const alerting = fixtureMandate({
      id: 'slipstream-alerting',
      poolId: SLIPSTREAM,
      addresses: [SYNTHETIC_OWNERS[1] as Address],
      kpis: { minDepthUsd: 1, ...DEFAULT_MANDATE_KPIS },
      alertWebhookUrl: 'https://hooks.example.invalid/depthwatch',
      alertAfterSamples: 1,
    })
    const world = await buildWorld([alerting], withFailingStakedOwners)
    try {
      const slipstreamIds = ['demo-slipstream-weth-usdc', alerting.id]
      // The snapshot itself is unaffected; only the Aerodrome v2 mandate is sampled.
      expect(world.snapshot.failed).toEqual([])
      expect(world.snapshot.snapshots).toBe(2)
      expect(world.snapshot.samples).toBe(1)
      expect(world.snapshot.sampleFailures).toBe(2)
      expect(world.snapshot.alerts).toBe(0)
      const sampled = await mmSampleStep(world.later)
      expect(sampled.samples).toBe(1)
      expect(sampled.failed.map((f) => f.item).sort()).toEqual([...slipstreamIds].sort())
      expect(sampled.alerts.attempts).toBe(0)
      for (const id of slipstreamIds) {
        expect(world.db.mmSamples.countFor(id)).toBe(0)
        expect(world.db.mmAlerts.countFor(id)).toBe(0)
      }
      expect(world.db.mmSamples.countFor('demo-aero-usdc-aero')).toBe(2)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      world.db.close()
    }
  }, 20_000)
})
