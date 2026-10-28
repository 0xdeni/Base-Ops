/**
 * `depthwatch start`: the one command a server runs. One process serves the API and the dashboard
 * (exactly what `serve` serves, listening before any chain request, even on an empty database)
 * and runs the pipeline on the schedule of start/scheduler.ts against the same database. The
 * settings are start/settings.ts; every request the chain reader sends is counted
 * (start/meter.ts) and reported per step and per day.
 *
 * The database must be writable: a file the process cannot write (restored as root and run as
 * `node`, a mount that refused the entrypoint's chown) fails the start with exit code 1 rather than
 * serving a site whose every pass fails.
 *
 * Stopping (SIGTERM / SIGINT, `main`'s signal): the chain reader stops sending at once and cancels
 * the request in flight, the step in flight stores nothing more (pipeline/context.ts), so it ends
 * within moments; no further step starts. The process waits for it at most
 * `DEPTHWATCH_SHUTDOWN_GRACE` (default 8 s, under Docker's 10 s stop timeout), abandons it after
 * that, closes the server and the database and returns, so the process exits 0.
 */
import type { ChainReader, RpcRequestEvent } from '@depthwatch/chain'
import { type Database, openDatabase } from '@depthwatch/db'
import type { Config } from '../config.js'
import { type Logger, resultFields } from '../log.js'
import { createPipelineContext, type PipelineContext, syncKeys } from '../pipeline/context.js'
import { discoverStep } from '../pipeline/discover.js'
import {
  POSITIONS_WINDOW_BLOCKS,
  positionsStep,
  unindexedMandatedPools,
} from '../pipeline/positions.js'
import { pruneDue, pruneStep } from '../pipeline/prune.js'
import { sleep } from '../pipeline/run.js'
import { scoreStep } from '../pipeline/score.js'
import { seedStep } from '../pipeline/seed.js'
import { snapshotStep } from '../pipeline/snapshot.js'
import { volumeStep } from '../pipeline/volume.js'
import { createCliChainReader, describeError } from '../rpc.js'
import { serveApi, waitForAbort } from '../serve.js'
import { RequestMeter } from './meter.js'
import {
  type CadencedStep,
  runScheduler,
  type SchedulerClock,
  type SchedulerSteps,
  type ScheduleStore,
} from './scheduler.js'

export interface ChainHooks {
  onRequest: (event: RpcRequestEvent) => void
  signal: AbortSignal
}

export interface StartOptions {
  config: Config
  log: Logger
  signal: AbortSignal
  stdout: (line: string) => void
  /** Tests: the chain reader to use, given the hooks it must honour (default: from the config). */
  createChain?: (hooks: ChainHooks) => ChainReader
  /** Tests: a fake clock (default: the wall clock and real timers). */
  clock?: SchedulerClock
  /** Overrides the auto-detected dashboard directory. */
  staticDir?: string
  /** Tests: stop scheduling after this many passes (the server keeps serving until the signal). */
  maxPasses?: number
}

export const wallClock: SchedulerClock = { now: () => Date.now(), sleep }

/**
 * The scheduler's steps over the pipeline of `ctx`; budgets are measured with `clockMs`. A volume
 * or positions run that found no tracked pool (the snapshot has not tracked any yet: a failed first
 * snapshot) reports a backlog, so the step is due again at the next pass instead of one interval
 * later.
 */
export function pipelineSteps(ctx: PipelineContext, clockMs: () => number): SchedulerSteps {
  const withLog = (log: Logger): PipelineContext => ({ ...ctx, log })
  const nothingTracked = () => ctx.db.pools.count({ tracked: true }) === 0
  return {
    needsSeed: () =>
      ctx.config.dexes.some((dex) => ctx.db.syncState.get(syncKeys.seed(dex)) === undefined),
    needsPositions: () => unindexedMandatedPools(ctx.db).length > 0,
    needsPrune: () => pruneDue(ctx.db, ctx.now()),
    seed: async (log) => ({ fields: resultFields(await seedStep(withLog(log))) }),
    snapshot: async (log) => ({ fields: resultFields(await snapshotStep(withLog(log))) }),
    volume: async (log) => {
      const result = await volumeStep(withLog(log))
      return { fields: resultFields(result), backlog: result.pools === 0 && nothingTracked() }
    },
    score: async (log) => ({ fields: resultFields(await scoreStep(withLog(log))) }),
    positions: async (log, budgetMs) => {
      const result = await positionsStep(withLog(log), {
        windowBlocks: POSITIONS_WINDOW_BLOCKS,
        budgetMs,
        clockMs,
      })
      const { positions, deferred, rounds } = result
      const fields = { pools: result.pools.length, positions, deferred, rounds }
      const backlog = deferred > 0 || (result.pools.length === 0 && nothingTracked())
      return { fields: { ...fields, failed: result.failed.length }, backlog }
    },
    discover: async (log, budgetMs) => {
      const result = await discoverStep(withLog(log), { budgetMs, clockMs })
      return { fields: { found: result.found }, backlog: !result.complete }
    },
    prune: async (log) => ({ fields: resultFields(await pruneStep(withLog(log))) }),
  }
}

/** The scheduler's memory of the cadenced steps, in `sync_state` so it survives a restart. */
export function syncStateStore(db: Database): ScheduleStore {
  return {
    lastRun: (step: CadencedStep) => {
      const value = db.syncState.get(syncKeys.startLastRun(step))
      return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
    },
    setLastRun: (step: CadencedStep, ms: number | undefined) => {
      if (ms === undefined) db.syncState.delete(syncKeys.startLastRun(step))
      else db.syncState.set(syncKeys.startLastRun(step), String(ms))
    },
  }
}

/** The sync_state key the write probe sets and deletes; never left behind. */
const WRITE_PROBE_KEY = 'start:writeProbe'

/**
 * Throws when the process cannot write the database. Opening a read-only file succeeds (reads
 * work, `BEGIN IMMEDIATE` too) and only the first write fails, so the probe writes: one row set
 * and deleted in one transaction, which leaves the database as it was.
 */
export function assertDatabaseWritable(db: Database): void {
  try {
    db.transaction(() => {
      db.syncState.set(WRITE_PROBE_KEY, '1')
      db.syncState.delete(WRITE_PROBE_KEY)
    })
  } catch (cause) {
    throw new Error(`database is not writable: ${db.path}`, { cause })
  }
}

/** True when `promise` settles within `ms`; the timer never outlives the race. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([promise.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function startCommand(opts: StartOptions): Promise<void> {
  const { config, log, signal } = opts
  const clock = opts.clock ?? wallClock
  const meter = new RequestMeter({ main: config.rpcUrl, logs: config.logsRpcUrl }, clock.now())
  const hooks: ChainHooks = { onRequest: meter.record, signal }
  const chain =
    opts.createChain?.(hooks) ??
    createCliChainReader(config, { command: 'start', live: true, ...hooks }, log)
  log.info('rpc providers', { main: meter.providers.main, logs: meter.providers.logs })
  const db = openDatabase(config.dbPath)
  try {
    assertDatabaseWritable(db)
    log.info('database open', { path: config.dbPath, schemaVersion: db.migration.to })
    const server = await serveApi({
      db,
      port: config.port,
      hostname: config.hostname,
      adminToken: config.adminToken,
      log,
      stdout: opts.stdout,
      staticDir: opts.staticDir,
    })
    try {
      const ctx = createPipelineContext({ db, chain, config, log, signal })
      const scheduler = runScheduler({
        settings: config.schedule,
        steps: pipelineSteps(ctx, () => clock.now()),
        store: syncStateStore(db),
        log,
        signal,
        clock,
        meter,
        describeError,
        maxPasses: opts.maxPasses,
      }).catch((error: unknown) => {
        log.error('scheduler stopped; still serving', { error: describeError(error) })
      })
      await waitForAbort(signal)
      const graceMs = config.schedule.shutdownGraceSeconds * 1000
      log.info('shutting down', { graceMs })
      if (!(await settlesWithin(scheduler, graceMs)))
        log.warn('abandoning the step in flight', { graceMs })
      log.info('usage today', meter.dayFields(meter.today(clock.now())))
    } finally {
      await server.close()
    }
  } finally {
    db.close()
  }
}
