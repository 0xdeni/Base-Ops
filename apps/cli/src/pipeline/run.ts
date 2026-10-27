/**
 * `run`: discover → [positions] → snapshot → volume → score, every `interval` seconds, until the
 * abort signal fires (SIGINT/SIGTERM in main). The order is the data's: `volume` values swaps at
 * the prices the snapshot just stored, and `score` runs straight after `volume` because the 24 h
 * volume window ends at the hour of the last block `volume` read (docs/METRICS.md, "24 h
 * volume"), so nothing runs between them to age it. With `--seed` the discover step seeds from the
 * factory views instead of scanning logs (pipeline/seed.ts), which a free RPC can serve. A failing
 * step is logged and the iteration carries on with the next step, so one bad RPC answer never
 * stops the indexer; a request whose backoff retries ran out (RetryExhaustedError) is such a
 * failure. The exception is a logs endpoint that only serves tiny `eth_getLogs` ranges
 * (LogRangeLimitError): no later pass can succeed, so `run` stops with that error. The current
 * step always finishes; the signal only cuts the wait between iterations.
 */
import { isLogRangeLimitError } from '@depthwatch/chain'
import { errorMessage, type Logger } from '../log.js'
import type { PipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { positionsStep } from './positions.js'
import { scoreStep } from './score.js'
import { seedStep } from './seed.js'
import { snapshotStep } from './snapshot.js'
import { volumeStep } from './volume.js'

export interface RunOptions {
  intervalSeconds?: number
  /** Run one iteration and return. */
  once?: boolean
  /** Include the positions step before each snapshot. */
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
}

export const PIPELINE_STEPS = ['discover', 'positions', 'snapshot', 'volume', 'score'] as const
export type PipelineStep = (typeof PIPELINE_STEPS)[number]

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
  if (withPositions)
    steps.splice(1, 0, ['positions', (step) => positionsStep({ ...ctx, log: step })])
  for (const [name, fn] of steps) {
    try {
      await log.timed(name, (step) => fn(step))
    } catch (error) {
      if (isLogRangeLimitError(error)) throw error
      failed.push({ step: name, error: errorMessage(error) })
    }
  }
  return { iteration, startedAt, ms: Date.now() - startedAt, failed }
}

/** Returns the number of completed iterations. */
export async function runLoop(ctx: PipelineContext, opts: RunOptions = {}): Promise<number> {
  const { log, config } = ctx
  const intervalMs = (opts.intervalSeconds ?? config.intervalSeconds) * 1000
  const once = opts.once ?? config.runOnce
  const withPositions = opts.withPositions ?? config.withPositions
  const wait = opts.sleep ?? sleep
  let iterations = 0
  while (!opts.signal?.aborted) {
    iterations++
    log.info('iteration start', { iteration: iterations, intervalSeconds: intervalMs / 1000 })
    const result = await runIteration(ctx, iterations, withPositions)
    log.info('iteration done', {
      iteration: iterations,
      ms: result.ms,
      failedSteps: result.failed.map((f) => f.step),
    })
    if (once || opts.signal?.aborted) break
    const remaining = Math.max(0, intervalMs - result.ms)
    log.info('sleeping', { ms: remaining })
    await wait(remaining, opts.signal)
  }
  return iterations
}
