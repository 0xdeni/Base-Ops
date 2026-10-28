/**
 * The scheduler's steps over the real pipeline and the synthetic Base world (no network): a
 * mandate on a pool whose positions are not indexed yet makes positions run in that very pass,
 * hours before its cadence, and the snapshot records no `none` sample for it meanwhile; a volume
 * or positions run that found no tracked pool (a failed first snapshot) is due again at the next
 * pass rather than one interval later.
 */
import type { ChainReader } from '@depthwatch/chain'
import { SYNTHETIC_POOL_IDS } from '@depthwatch/chain'
import type { Mandate } from '@depthwatch/core'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain, registerDemoMandates } from '../demo.js'
import { createLogger, type Logger } from '../log.js'
import { createPipelineContext, type PipelineContext, syncKeys } from '../pipeline/context.js'
import { discoverStep } from '../pipeline/discover.js'
import { positionsPublished } from '../pipeline/positions.js'
import { runScheduler, type SchedulerSteps, type Step, type StepReport } from './scheduler.js'
import { SCHEDULE_DEFAULTS } from './settings.js'
import { pipelineSteps, syncStateStore } from './start.js'

const SLIPSTREAM = SYNTHETIC_POOL_IDS.wethUsdcSlipstream

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

function fakeClock() {
  let t = Date.UTC(2026, 9, 25, 12, 0, 0)
  return {
    now: () => t,
    sleep: async (ms: number, signal: AbortSignal) => {
      if (!signal.aborted) t += ms
    },
  }
}

interface World {
  db: Database
  ctx: PipelineContext
  lines: string[]
  latestTimestamp: number
}

/** The synthetic world discovered into a database already seeded (the seed step is skipped). */
async function world(wrapChain: (chain: ChainReader) => ChainReader = (c) => c): Promise<World> {
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  const chain = wrapChain(createDemoChain())
  const latest = await chain.getLatestBlock()
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const config = loadConfig({})
  const ctx = createPipelineContext({ db, chain, config, log, now: () => latest.timestamp })
  for (const dex of config.dexes) db.syncState.setBigInt(syncKeys.seed(dex), latest.number)
  await discoverStep(ctx)
  return { db, ctx, lines, latestTimestamp: latest.timestamp }
}

interface Call {
  step: Step
  pass: number
}

/** `steps` with every call recorded, with the pass it belongs to; `onPass` runs as a pass starts. */
function recording(
  steps: SchedulerSteps,
  onPass: (pass: number) => void,
): { steps: SchedulerSteps; calls: Call[] } {
  const calls: Call[] = []
  let pass = 0
  const record = (step: Step, report: Promise<StepReport>) => {
    calls.push({ step, pass })
    return report
  }
  return {
    calls,
    steps: {
      needsSeed: steps.needsSeed,
      needsPositions: steps.needsPositions,
      seed: (log: Logger) => record('seed', steps.seed(log)),
      snapshot: (log: Logger) => {
        pass++
        onPass(pass)
        return record('snapshot', steps.snapshot(log))
      },
      volume: (log: Logger) => record('volume', steps.volume(log)),
      score: (log: Logger) => record('score', steps.score(log)),
      positions: (log: Logger, budget: number) => record('positions', steps.positions(log, budget)),
      discover: (log: Logger, budget: number) => record('discover', steps.discover(log, budget)),
    },
  }
}

/** Runs `passes` passes of the real steps at the default schedule; returns the calls made. */
async function run(
  w: World,
  passes: number,
  clock = fakeClock(),
  onPass: (pass: number) => void = () => {},
): Promise<Call[]> {
  const rec = recording(
    pipelineSteps(w.ctx, () => clock.now()),
    onPass,
  )
  await runScheduler({
    settings: SCHEDULE_DEFAULTS,
    steps: rec.steps,
    store: syncStateStore(w.db),
    log: w.ctx.log,
    signal: new AbortController().signal,
    clock,
    maxPasses: passes,
  })
  return rec.calls
}

const passesOf = (calls: Call[], step: Step) =>
  calls.filter((c) => c.step === step).map((c) => c.pass)

describe('pipelineSteps: a mandate on a pool without positions', () => {
  it('runs positions in that pass, off cadence, and samples the mandate only once they exist', async () => {
    const w = await world()
    const [slipstream, aero] = registerDemoMandates(w.db, w.latestTimestamp) as [Mandate, Mandate]
    const clock = fakeClock()
    // Positions ran a moment ago as far as the schedule knows: not due for six hours.
    syncStateStore(w.db).setLastRun('positions', clock.now())
    expect(positionsPublished(w.db, SLIPSTREAM)).toBe(false)

    // The head moves one block a pass, as a live chain's does: a mandate has one sample per block.
    const head = await w.ctx.chain.getLatestBlock()
    const calls = await run(w, 2, clock, (pass) => {
      w.ctx.chain = createDemoChain({
        latestBlock: head.number + BigInt(pass - 1),
        latestTimestamp: head.timestamp + 2 * (pass - 1),
      })
    })
    expect(passesOf(calls, 'positions')).toEqual([1])
    expect(positionsPublished(w.db, SLIPSTREAM)).toBe(true)
    // Pass 1's snapshot reported the Slipstream mandate as an attribution failure, no sample.
    expect(w.lines.some((l) => /\[snapshot\] done .*samples=1 sampleFailures=1 /.test(l))).toBe(
      true,
    )
    expect(
      w.lines.some((l) => l.includes('positions not indexed yet') && l.includes(slipstream.id)),
    ).toBe(true)
    // Pass 2's snapshot sampled it from the positions pass 1 indexed.
    expect(w.db.mmSamples.countFor(slipstream.id)).toBe(1)
    expect(w.db.mmSamples.countFor(aero.id)).toBe(2)
    expect(w.db.mmSamples.latestFor(slipstream.id)?.attribution.method).toBe('positions')
    for (const mandate of [slipstream, aero])
      for (const sample of w.db.mmSamples.seriesFor(mandate.id, 0))
        expect(sample.attribution.method).not.toBe('none')
    expect(w.db.mmAlerts.countFor(slipstream.id)).toBe(0)
  }, 60_000)
})

describe('pipelineSteps: a first snapshot that fails', () => {
  it('leaves volume and positions due at the next pass, since nothing was tracked', async () => {
    let failOnce = true
    const w = await world((chain) => ({
      ...chain,
      readOverview: (pools, blockNumber) => {
        if (!failOnce) return chain.readOverview(pools, blockNumber)
        failOnce = false
        return Promise.reject(new Error('HTTP 429 storm'))
      },
    }))
    const calls = await run(w, 3)
    expect(passesOf(calls, 'snapshot')).toEqual([1, 2, 3])
    // Pass 1 found nothing to index; pass 2 indexed the pools the snapshot had just tracked;
    // pass 3 (an hour in) is back on the cadence: neither is due.
    expect(passesOf(calls, 'volume')).toEqual([1, 2])
    expect(passesOf(calls, 'positions')).toEqual([1, 2])
    expect(
      w.lines.some((l) => /\[snapshot\] failed; tried again at its next slot .*429 storm/.test(l)),
    ).toBe(true)
    expect(w.lines.some((l) => /\[volume\] done .*pools=0 .*backlog=true/.test(l))).toBe(true)
    expect(w.lines.some((l) => /\[positions\] done .*pools=0 .*backlog=true/.test(l))).toBe(true)
    expect(w.db.pools.count({ tracked: true })).toBeGreaterThan(0)
    expect(w.db.syncState.get(syncKeys.volume())).toBeDefined()
    expect(w.db.volume.count()).toBeGreaterThan(0)
    expect(w.db.positions.forPool(SLIPSTREAM).length).toBeGreaterThan(0)
  }, 60_000)
})
