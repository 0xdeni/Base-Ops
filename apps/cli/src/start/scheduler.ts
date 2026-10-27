/**
 * The pipeline scheduler of `depthwatch start`. It runs one pass every snapshot interval, and the
 * steps of a pass one after the other, so no two steps ever overlap:
 *
 *   [seed] → snapshot → [volume] → score → [positions] → [discover] → [prune]
 *
 * - seed (`discover --seed`) runs at the start of every pass until one has succeeded: on an empty
 *   database the first pass seeds, snapshots and scores, so the site has data within minutes.
 * - snapshot and score run every pass; volume once its interval has passed since its last run
 *   (score follows it, since the 24 h volume window ends at the volume head).
 * - positions once its interval has passed, within its budget, and whatever the cadence while an
 *   active mandate's concentrated pool has no positions yet (`needsPositions`: the snapshot does
 *   not sample such a mandate); while it reports a backlog (pools still catching up, or no pool to
 *   index yet) it runs again at the next pass.
 * - discover (the log scan from the factories' deployment blocks, resumable) every pass, within
 *   its budget and never past the time the next pass is due, so a first full discovery spreads
 *   over passes and never delays a snapshot by more than one window.
 * - prune (retention, pipeline/prune.ts) closes the pass once a day (`needsPrune`: a day since the
 *   last one, or never); database only, so no budget.
 *
 * Budgets are also cut to the time left before the next pass; under MIN_BUDGET_MS the step waits
 * for the next pass. A step that throws is logged and the pass goes on; it is tried again at its
 * next slot (volume and positions: one interval after this attempt). Each step logs one `done`
 * line with its duration, its result and the requests it sent (start/meter.ts), and the first
 * step of each UTC day logs the previous day's total first. When the signal aborts, the step in
 * flight ends (the chain reader stops sending and the step stores nothing more), its line reads
 * `stopped for shutdown` whether it threw or returned, nothing is recorded, and no further step
 * starts.
 */
import { errorMessage, type LogFields, type Logger } from '../log.js'
import { type RequestMeter, usageSince } from './meter.js'
import type { ScheduleSettings } from './settings.js'

export const STEPS = [
  'seed',
  'snapshot',
  'volume',
  'score',
  'positions',
  'discover',
  'prune',
] as const
export type Step = (typeof STEPS)[number]
/** Steps with their own cadence, whose last run is kept across restarts. */
export type CadencedStep = 'volume' | 'positions'

/** A budget under this is not worth starting a step for: it waits for the next pass. */
export const MIN_BUDGET_MS = 30_000
/** Passes drift by milliseconds; a cadenced step this close to due counts as due. */
export const DUE_SLACK_MS = 5_000

export interface StepReport {
  /** Result fields for the step's `done` line. */
  fields?: LogFields
  /** Work left when the budget ran out: the step is due again at the next pass. */
  backlog?: boolean
}

export interface SchedulerSteps {
  /** True until a seed has succeeded. */
  needsSeed(): boolean
  /** True while an active mandate's concentrated pool has no positions: positions runs this pass. */
  needsPositions(): boolean
  /** True once a day has passed since the last prune (or none ran): prune closes this pass. */
  needsPrune(): boolean
  seed(log: Logger): Promise<StepReport>
  snapshot(log: Logger): Promise<StepReport>
  volume(log: Logger): Promise<StepReport>
  score(log: Logger): Promise<StepReport>
  positions(log: Logger, budgetMs: number): Promise<StepReport>
  discover(log: Logger, budgetMs: number): Promise<StepReport>
  prune(log: Logger): Promise<StepReport>
}

/** When the cadenced steps last ran (unix ms); undefined: due now. */
export interface ScheduleStore {
  lastRun(step: CadencedStep): number | undefined
  setLastRun(step: CadencedStep, ms: number | undefined): void
}

export interface SchedulerClock {
  /** Unix milliseconds. */
  now(): number
  /** Resolves after `ms`, or as soon as `signal` aborts; never rejects. */
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

export interface SchedulerOptions {
  settings: ScheduleSettings
  steps: SchedulerSteps
  store: ScheduleStore
  log: Logger
  signal: AbortSignal
  clock: SchedulerClock
  meter?: RequestMeter
  /** One line for a failure (default `errorMessage`; start passes the CLI's `describeError`). */
  describeError?: (error: unknown) => string
  /** Stop after this many passes (tests); unset: until the signal aborts. */
  maxPasses?: number
}

type Outcome = 'ok' | 'backlog' | 'failed' | 'stopped'

/** `30m`, `1h`, `1h30m`, `45s`: a setting as it reads in the schedule line. */
export function formatSeconds(seconds: number): string {
  if (seconds === 0) return 'off'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h > 0 ? `${h}h` : ''}${m > 0 ? `${m}m` : ''}${s > 0 ? `${s}s` : ''}`
}

export function scheduleFields(settings: ScheduleSettings): LogFields {
  return {
    snapshotInterval: formatSeconds(settings.snapshotIntervalSeconds),
    volumeInterval: formatSeconds(settings.volumeIntervalSeconds),
    positionsInterval: formatSeconds(settings.positionsIntervalSeconds),
    positionsBudget: formatSeconds(settings.positionsBudgetSeconds),
    discoverBudget: formatSeconds(settings.discoverBudgetSeconds),
  }
}

/** Runs passes until the signal aborts (or `maxPasses`); returns the number of passes started. */
export async function runScheduler(opts: SchedulerOptions): Promise<number> {
  const { settings, steps, store, log, signal, clock, meter } = opts
  const describe = opts.describeError ?? errorMessage
  const passMs = settings.snapshotIntervalSeconds * 1000

  async function runStep(step: Step, fn: (log: Logger) => Promise<StepReport>): Promise<Outcome> {
    if (signal.aborted) return 'stopped'
    const day = meter?.closeDay(clock.now())
    if (day !== undefined && meter !== undefined) log.info('daily total', meter.dayFields(day))
    const stepLog = log.child(step)
    const started = clock.now()
    const before = meter?.usage()
    let outcome: Outcome = 'ok'
    let report: StepReport = {}
    let failure: unknown
    try {
      report = await fn(stepLog)
      // A step that returns after the stop signal stored nothing more (pipeline/context.ts).
      if (signal.aborted) outcome = 'stopped'
      else if (report.backlog === true) outcome = 'backlog'
    } catch (error) {
      failure = error
      outcome = signal.aborted ? 'stopped' : 'failed'
    }
    const usage = meter && before ? meter.fields(usageSince(before, meter.usage())) : {}
    const ms = clock.now() - started
    if (outcome === 'stopped') stepLog.info('stopped for shutdown', { ms, ...usage })
    else if (outcome === 'failed')
      stepLog.error('failed; tried again at its next slot', {
        ms,
        error: describe(failure),
        ...usage,
      })
    else
      stepLog.info('done', {
        ms,
        ...report.fields,
        ...(outcome === 'backlog' ? { backlog: true } : {}),
        ...usage,
      })
    return outcome
  }

  function due(step: CadencedStep, intervalSeconds: number, passStart: number): boolean {
    const last = store.lastRun(step)
    if (last === undefined || last > passStart) return true
    return passStart - last + DUE_SLACK_MS >= intervalSeconds * 1000
  }

  function record(step: CadencedStep, outcome: Outcome, passStart: number): void {
    if (outcome === 'stopped' || signal.aborted) return
    store.setLastRun(step, outcome === 'backlog' ? undefined : passStart)
  }

  /** The budget left for a step before the next pass, or undefined when too little is left. */
  function budgetFor(step: Step, budgetSeconds: number, nextPassAt: number): number | undefined {
    const budget = Math.min(budgetSeconds * 1000, nextPassAt - clock.now())
    if (budget >= MIN_BUDGET_MS) return budget
    log.info('no time left before the next pass', { step, leftMs: Math.max(0, budget) })
    return undefined
  }

  async function pass(passNo: number, passStart: number): Promise<Step[]> {
    const nextPassAt = passStart + passMs
    const failed: Step[] = []
    const bootstrap = steps.needsSeed()
    log.info('pass start', { pass: passNo, ...(bootstrap ? { bootstrap } : {}) })
    const run = async (step: Step, fn: (log: Logger) => Promise<StepReport>) => {
      const outcome = await runStep(step, fn)
      if (outcome === 'failed') failed.push(step)
      return outcome
    }
    if (bootstrap) await run('seed', (l) => steps.seed(l))
    await run('snapshot', (l) => steps.snapshot(l))
    if (due('volume', settings.volumeIntervalSeconds, passStart))
      record('volume', await run('volume', (l) => steps.volume(l)), passStart)
    await run('score', (l) => steps.score(l))
    if (
      settings.positionsIntervalSeconds > 0 &&
      !signal.aborted &&
      (steps.needsPositions() || due('positions', settings.positionsIntervalSeconds, passStart))
    ) {
      const budget = budgetFor('positions', settings.positionsBudgetSeconds, nextPassAt)
      if (budget !== undefined)
        record('positions', await run('positions', (l) => steps.positions(l, budget)), passStart)
    }
    if (settings.discoverBudgetSeconds > 0 && !signal.aborted) {
      const budget = budgetFor('discover', settings.discoverBudgetSeconds, nextPassAt)
      if (budget !== undefined) await run('discover', (l) => steps.discover(l, budget))
    }
    if (!signal.aborted && steps.needsPrune()) await run('prune', (l) => steps.prune(l))
    return failed
  }

  log.info('schedule', scheduleFields(settings))
  let passes = 0
  while (!signal.aborted && (opts.maxPasses === undefined || passes < opts.maxPasses)) {
    passes++
    const passStart = clock.now()
    let failed: Step[] = []
    try {
      failed = await pass(passes, passStart)
    } catch (error) {
      // Only the scheduler's own bookkeeping (database reads of the store) gets here.
      if (!signal.aborted) log.error('pass failed', { pass: passes, error: describe(error) })
    }
    if (signal.aborted) break
    const waitMs = Math.max(0, passStart + passMs - clock.now())
    log.info('pass done', { pass: passes, ms: clock.now() - passStart, failed, nextInMs: waitMs })
    if (opts.maxPasses !== undefined && passes >= opts.maxPasses) break
    await clock.sleep(waitMs, signal)
  }
  return passes
}
