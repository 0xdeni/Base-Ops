/**
 * A mandate registered on a concentrated pool before any `positions` run reached it, over the
 * synthetic Base world: the snapshot (and `mm sample`) reports an attribution failure and stores
 * no sample, never a `none` sample with a false `noLiquidity` breach, and the first snapshot after
 * the pool's positions are published samples it with method `positions`.
 */
import { SYNTHETIC_POOL_IDS } from '@depthwatch/chain'
import type { Mandate } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain, registerDemoMandates } from '../demo.js'
import { createLogger } from '../log.js'
import { createPipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { mmSampleStep, POSITIONS_NOT_INDEXED } from './mm.js'
import { positionsStep, unindexedMandatedPools } from './positions.js'
import { snapshotStep } from './snapshot.js'

const SLIPSTREAM = SYNTHETIC_POOL_IDS.wethUsdcSlipstream

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

describe('a mandate on a pool whose positions are not indexed yet', () => {
  it('is an attribution failure until a positions run publishes them', async () => {
    const db = openDatabase(IN_MEMORY)
    dbs.push(db)
    const chain = createDemoChain()
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
    const [slipstream, aero] = registerDemoMandates(db, latest.timestamp) as [Mandate, Mandate]
    await discoverStep(ctx)
    expect(unindexedMandatedPools(db).map((pool) => pool.id)).toEqual([SLIPSTREAM])

    // The snapshot tracks both mandated pools and samples only the Aerodrome v2 one.
    const first = await snapshotStep(ctx)
    expect(first).toMatchObject({
      tracked: 2,
      snapshots: 2,
      samples: 1,
      sampleFailures: 1,
      alerts: 0,
      failed: [],
    })
    expect(db.mmSamples.countFor(slipstream.id)).toBe(0)
    expect(db.mmSamples.countFor(aero.id)).toBe(1)
    expect(
      lines.some((l) => l.includes('positions not indexed yet') && l.includes(slipstream.id)),
    ).toBe(true)
    const sampled = await mmSampleStep(ctx)
    expect(sampled.samples).toBe(1)
    expect(sampled.failed).toEqual([{ item: slipstream.id, error: POSITIONS_NOT_INDEXED }])
    expect(db.mmSamples.countFor(slipstream.id)).toBe(0)
    expect(db.mmAlerts.countFor(slipstream.id)).toBe(0)

    await positionsStep(ctx)
    expect(unindexedMandatedPools(db)).toEqual([])
    const second = await snapshotStep(ctx)
    expect(second).toMatchObject({ samples: 2, sampleFailures: 0 })
    const sample = db.mmSamples.latestFor(slipstream.id)
    expect(sample?.attribution.method).toBe('positions')
    expect(sample?.withinKpi).toBe(true)
    expect(db.mmSamples.seriesFor(slipstream.id, 0).map((s) => s.attribution.method)).toEqual([
      'positions',
    ])
  }, 30_000)
})
