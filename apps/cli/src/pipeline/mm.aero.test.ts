/**
 * Market-maker attribution on the Aero pools of the synthetic world, through the same pipeline
 * code as on Aerodrome (no DEX id is compared): an Aero Slipstream position staked in the pool's
 * CLGauge resolves to its depositor (`CLGauge.stakedContains`), and an Aero v2 LP share counts
 * the LP tokens staked in the gauge the FactoryRegistry names.
 */
import { SYNTHETIC_GAUGES, SYNTHETIC_OWNERS, SYNTHETIC_POOL_IDS } from '@depthwatch/chain'
import { DEFAULT_MANDATE_KPIS, type Mandate } from '@depthwatch/core'
import { type Database, fixtureMandate, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain } from '../demo.js'
import { createPipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { positionsStep, storedCustodians } from './positions.js'
import { type SnapshotResult, snapshotStep } from './snapshot.js'

const AERO_CL = SYNTHETIC_POOL_IDS.wethUsdcAeroSlipstream
const AERO_V2 = SYNTHETIC_POOL_IDS.aeroUsdcAeroV2

const mandate = (id: string, poolId: string, owner: number): Mandate =>
  fixtureMandate({
    id,
    poolId,
    addresses: [SYNTHETIC_OWNERS[owner] as `0x${string}`],
    kpis: { ...DEFAULT_MANDATE_KPIS, minDepthUsd: 1 },
  })

describe('attribution on the Aero pools', () => {
  let db: Database
  let snapshot: SnapshotResult

  beforeAll(async () => {
    db = openDatabase(IN_MEMORY)
    const chain = createDemoChain()
    const latest = await chain.getLatestBlock()
    const ctx = createPipelineContext({
      db,
      chain,
      config: loadConfig({}, { top: '0' }),
      now: () => latest.timestamp,
    })
    db.mandates.upsertMany([
      // Owner 1's [-500, 500] position is staked in the Aero CLGauge.
      mandate('aero-cl-staked', AERO_CL, 1),
      // Owner 2 holds 15 % of the LP supply in its wallet and 35 % staked.
      mandate('aero-v2-share', AERO_V2, 2),
    ])
    await discoverStep(ctx)
    await positionsStep(ctx, { pools: db.pools.list() })
    snapshot = await snapshotStep(ctx)
  }, 20_000)
  afterAll(() => db.close())

  it('tracks and samples both mandated Aero pools', () => {
    expect(db.pools.trackedIds().sort()).toEqual([AERO_CL, AERO_V2].sort())
    expect(snapshot).toMatchObject({ snapshots: 2, samples: 2, sampleFailures: 0, failed: [] })
  })

  it('resolves the CLGauge-held position to its depositor', () => {
    const stored = db.positions.forPool(AERO_CL)
    const gauge = SYNTHETIC_GAUGES.wethUsdcAeroSlipstream
    expect(stored.filter((p) => p.owner === gauge)).toHaveLength(3)
    expect(storedCustodians(db, AERO_CL)).toEqual([gauge])
    const sample = db.mmSamples.latestFor('aero-cl-staked')
    expect(sample?.attribution).toMatchObject({ method: 'positions', holdings: 1 })
    expect(sample?.attribution.depthUpUsd ?? 0).toBeGreaterThan(0)
    expect(sample?.withinKpi).toBe(true)
  })

  it('counts the LP tokens staked in the registry gauge in the share', () => {
    const sample = db.mmSamples.latestFor('aero-v2-share')
    expect(sample?.attribution).toMatchObject({ method: 'lp-share', holdings: 1 })
    // 15 % in the wallet plus 35 % staked, of an LP supply that others hold the rest of.
    expect(sample?.attribution.shareOfPool ?? 0).toBeCloseTo(0.5, 6)
  })
})
