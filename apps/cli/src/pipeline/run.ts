/**
 * `run`: discover → [positions] → snapshot → volume → score → [prune], every `interval` seconds,
 * until the abort signal fires (SIGINT/SIGTERM in main). Positions runs for the concentrated pools of the
 * active mandates (`mandatedConcentratedPools`), so the snapshot that follows attributes their
 * scorecards from the first pass on, and with `--with-positions` for every tracked pool; with
 * neither a mandate nor the flag the step is left out. The order is the data's: `volume` values swaps at
 * the prices the snapshot just stored, and `score` runs straight after `volume` because the 24 h
 * volume window ends at the hour of the last block `volume` read (docs/METRICS.md, "24 h
 * volume"), so nothing runs between them to age it. With `--seed` the discover step seeds from the
 * factory views instead of scanning logs (pipeline/seed.ts), which a free RPC can serve. A failing
 * step is logged and the iteration carries on with the next step, so one bad RPC answer never
 * stops the indexer; a request whose backoff retries ran out (RetryExhaustedError) is such a
 * failure. The exceptions: a logs endpoint that only serves tiny `eth_getLogs` ranges
 * (LogRangeLimitError), since no later pass can succeed, and STALL_PASSES passes in a row in
 * which every step that reads the chain failed (the endpoint is down or its key revoked), since
 * carrying on would only keep a stale site looking alive: `run` stops with that error, and a
 * supervisor restarts or alerts. `run --once` returns its pass's failed steps for main to turn
 * into the exit code. Prune (retention, pipeline/prune.ts) closes the pass once a day. The
 * current step always finishes; the signal only cuts the wait between iterations.
 */
import { isLogRangeLimitError } from '@depthwatch/chain'
import { errorMessage, type Logger } from '../log.js'
import type { PipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { mandatedConcentratedPools, positionsStep } from './positions.js'
import { pruneDue, pruneStep } from './prune.js'
import { scoreStep } from './score.js'
import { seedStep } from './seed.js'
import { snapshotStep } from './snapshot.js'
import { volumeStep } from './volume.js'

export interface RunOptions {
  intervalSeconds?: number
  /** Run one iteration and return. */
  once?: boolean
  /** Index the positions of every tracked pool before each snapshot, not only the mandated pools'. */
  withPositions?: boolean
  signal?: AbortSignal
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface IterationResult {
  iteration: number
  startedAt: number
  ms: number
  /** Steps that threw, with their messages. */
  failed: Array<{ step: string; error: string }>
  /** Every step that read the chain in this pass failed: the endpoint, not a pool, is the problem. */
  stalled: boolean
}

export const PIPELINE_STEPS = [
  'discover',
  'positions',
  'snapshot',
  'volume',
  'score',
  'prune',
] as const
export type PipelineStep = (typeof PIPELINE_STEPS)[number]
/** The steps that read the chain; score and prune only read the database. */
export const CHAIN_STEPS: ReadonlySet<PipelineStep> = new Set<PipelineStep>([
  'discover',
  'positions',
  'snapshot',
  'volume',
])
/** Stalled passes in a row after which the loop stops with a PipelineStalledError. */
export const STALL_PASSES = 3

export class PipelineStalledError extends Error {
  override readonly name = 'PipelineStalledError'
}

export interface RunLoopResult {
  iterations: number
  /** The failed steps of the last pass (`run --once`: what decides its exit code). */
  lastFailed: IterationResult['failed']
}

/** Resolves after `ms`, or as soon as `signal` aborts (never rejects). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** One pass over the pipeline; every step is isolated so later steps still run (see above). */
export async function runIteration(
  ctx: PipelineContext,
  iteration: number,
  withPositions: boolean,
): Promise<IterationResult> {
  const { log } = ctx
  const startedAt = Date.now()
  const failed: IterationResult['failed'] = []
  const steps: Array<[PipelineStep, (step: Logger) => Promise<unknown>]> = [
    [
      'discover',
      (step) =>
        ctx.config.seed ? seedStep({ ...ctx, log: step }) : discoverStep({ ...ctx, log: step }),
    ],
    ['snapshot', (step) => snapshotStep({ ...ctx, log: step })],
    ['volume', (step) => volumeStep({ ...ctx, log: step })],
    ['score', (step) => scoreStep({ ...ctx, log: step })],
  ]
  const mandated = withPositions ? [] : mandatedConcentratedPools(ctx.db)
  if (withPositions || mandated.length > 0)
    steps.splice(1, 0, [
      'positions',
      (step) => positionsStep({ ...ctx, log: step }, withPositions ? {} : { pools: mandated }),
    ])
  if (pruneDue(ctx.db, ctx.now())) steps.push(['prune', (step) => pruneStep({ ...ctx, log: step })])
  for (const [name, fn] of steps) {
    try {
      await log.timed(name, (step) => fn(step))
    } catch (error) {
      if (isLogRangeLimitError(error)) throw error
      failed.push({ step: name, error: errorMessage(error) })
    }
  }
  const failedSteps = new Set(failed.map((f) => f.step))
  const chainSteps = steps.map(([name]) => name).filter((name) => CHAIN_STEPS.has(name))
  const stalled = chainSteps.length > 0 && chainSteps.every((name) => failedSteps.has(name))
  return { iteration, startedAt, ms: Date.now() - startedAt, failed, stalled }
}

/**
 * Runs passes until the signal aborts (`once`: one pass) and returns their count with the last
 * pass's failed steps. In the loop, STALL_PASSES stalled passes in a row throw a
 * PipelineStalledError (see the header); a pass with any chain step succeeding resets the count.
 */
export async function runLoop(ctx: PipelineContext, opts: RunOptions = {}): Promise<RunLoopResult> {
  const { log, config } = ctx
  const intervalMs = (opts.intervalSeconds ?? config.intervalSeconds) * 1000
  const once = opts.once ?? config.runOnce
  const withPositions = opts.withPositions ?? config.withPositions
  const wait = opts.sleep ?? sleep
  let iterations = 0
  let lastFailed: IterationResult['failed'] = []
  let stalledPasses = 0
  while (!opts.signal?.aborted) {
    iterations++
    log.info('iteration start', { iteration: iterations, intervalSeconds: intervalMs / 1000 })
    const result = await runIteration(ctx, iterations, withPositions)
    lastFailed = result.failed
    stalledPasses = result.stalled ? stalledPasses + 1 : 0
    log.info('iteration done', {
      iteration: iterations,
      ms: result.ms,
      failedSteps: result.failed.map((f) => f.step),
      ...(result.stalled ? { stalledPasses } : {}),
    })
    if (once || opts.signal?.aborted) break
    if (stalledPasses >= STALL_PASSES) {
      const errors = result.failed.map((f) => `${f.step}: ${f.error}`).join('; ')
      throw new PipelineStalledError(
        `run: every step that reads the chain failed in ${stalledPasses} passes in a row; ` +
          `last errors: ${errors}`,
      )
    }
    const remaining = Math.max(0, intervalMs - result.ms)
    log.info('sleeping', { ms: remaining })
    await wait(remaining, opts.signal)
  }
  return { iterations, lastFailed }
}
