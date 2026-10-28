/**
 * The scheduler of `depthwatch start` with a fake clock and fake steps: what runs in which pass
 * (bootstrap, cadences, backlogs, positions out of cadence for a mandate without positions), that
 * steps never overlap, how budgets are cut, that failures stay inside their step and that an
 * abort stops it, whether the step in flight throws or returns.
 */
import { describe, expect, it } from 'vitest'
import { createLogger, type Logger } from '../log.js'
import { RequestMeter } from './meter.js'
import {
  type CadencedStep,
  MIN_BUDGET_MS,
  runScheduler,
  type SchedulerSteps,
  type ScheduleStore,
  type Step,
  type StepReport,
} from './scheduler.js'
import { SCHEDULE_DEFAULTS, type ScheduleSettings } from './settings.js'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 25, 8, 0, 0)

function fakeClock(start = T0) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
    sleep: async (ms: number, signal: AbortSignal) => {
      if (!signal.aborted) t += ms
    },
  }
}
type FakeClock = ReturnType<typeof fakeClock>

function memoryStore(): ScheduleStore & { map: Map<CadencedStep, number> } {
  const map = new Map<CadencedStep, number>()
  return {
    map,
    lastRun: (step) => map.get(step),
    setLastRun: (step, ms) => {
      if (ms === undefined) map.delete(step)
      else map.set(step, ms)
    },
  }
}

interface Call {
  step: Step
  pass: number
  at: number
  budgetMs?: number
}

interface FakeOptions {
  /** Minutes each step takes. */
  minutes?: Partial<Record<Step, number>>
  /** Throw from the step on this call (1-based count per step). */
  fail?: (step: Step, call: number) => boolean
  backlog?: (step: Step, call: number) => boolean
  /** Runs inside the step, before it returns. */
  during?: (step: Step, call: number) => void
  /** What `needsPositions` answers (default false). */
  needsPositions?: () => boolean
  /** What `needsPrune` answers (default false). */
  needsPrune?: () => boolean
}

function fakeSteps(clock: FakeClock, opts: FakeOptions = {}) {
  const calls: Call[] = []
  let seeded = false
  let active = 0
  let maxActive = 0
  let pass = 0
  const counts = new Map<Step, number>()
  const run =
    (step: Step) =>
    async (_log: Logger, budgetMs?: number): Promise<StepReport> => {
      const call = (counts.get(step) ?? 0) + 1
      counts.set(step, call)
      if (step === 'snapshot') pass++
      calls.push({ step, pass, at: clock.now(), ...(budgetMs === undefined ? {} : { budgetMs }) })
      active++
      maxActive = Math.max(maxActive, active)
      try {
        await Promise.resolve()
        clock.advance((opts.minutes?.[step] ?? 1) * MIN)
        opts.during?.(step, call)
        if (opts.fail?.(step, call)) throw new Error(`${step} broke`)
        if (step === 'seed') seeded = true
        return { fields: { call }, backlog: opts.backlog?.(step, call) ?? false }
      } finally {
        active--
      }
    }
  const steps: SchedulerSteps = {
    needsSeed: () => !seeded,
    needsPositions: () => opts.needsPositions?.() ?? false,
    needsPrune: () => opts.needsPrune?.() ?? false,
    seed: run('seed'),
    snapshot: run('snapshot'),
    volume: run('volume'),
    score: run('score'),
    positions: run('positions'),
    discover: run('discover'),
    prune: run('prune'),
  }
  return {
    steps,
    calls,
    maxActive: () => maxActive,
    byPass: (n: number) => calls.filter((c) => c.pass === n).map((c) => c.step),
  }
}

function setup(opts: FakeOptions & { settings?: Partial<ScheduleSettings>; passes?: number }) {
  const clock = fakeClock()
  const fake = fakeSteps(clock, opts)
  const store = memoryStore()
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(clock.now()) })
  const controller = new AbortController()
  const settings = { ...SCHEDULE_DEFAULTS, ...opts.settings }
  const run = (extra: { maxPasses?: number; meter?: RequestMeter } = {}) =>
    runScheduler({
      settings,
      steps: fake.steps,
      store,
      log,
      signal: controller.signal,
      clock,
      maxPasses: extra.maxPasses ?? opts.passes ?? 3,
      meter: extra.meter,
    })
  return { clock, fake, store, lines, controller, run }
}

describe('runScheduler: bootstrap and cadences', () => {
  it('seeds, snapshots and scores first on an empty database, then discovers', async () => {
    const { fake, run } = setup({ passes: 3 })
    expect(await run()).toBe(3)
    expect(fake.byPass(1)).toEqual(['snapshot', 'volume', 'score', 'positions', 'discover'])
    // The seed runs before the first snapshot of the first pass.
    expect(fake.calls[0]?.step).toBe('seed')
    expect(fake.byPass(2)).toEqual(['snapshot', 'score', 'discover'])
    expect(fake.byPass(3)).toEqual(['snapshot', 'volume', 'score', 'discover'])
    expect(fake.calls.filter((c) => c.step === 'seed')).toHaveLength(1)
    expect(fake.maxActive()).toBe(1)
  })

  it('starts passes one snapshot interval apart, or at once after a pass that overran', async () => {
    const snapshotsAt = (calls: Call[]) =>
      calls.filter((c) => c.step === 'snapshot').map((c) => (c.at - T0) / MIN)
    const onTime = setup({ passes: 3 })
    await onTime.run()
    expect(snapshotsAt(onTime.fake.calls)).toEqual([1, 30, 60])
    // Discovery overruns its budget by 25 minutes each time: the next pass starts when it ends.
    const late = setup({ passes: 3, minutes: { discover: 40 } })
    await late.run()
    expect(snapshotsAt(late.fake.calls)).toEqual([1, 45, 87])
    expect(late.fake.maxActive()).toBe(1)
  })

  it('runs positions again at the next pass while it reports a backlog', async () => {
    const { fake, run, store } = setup({
      passes: 4,
      backlog: (step, call) => step === 'positions' && call === 1,
    })
    await run()
    const positionsPasses = fake.calls.filter((c) => c.step === 'positions').map((c) => c.pass)
    expect(positionsPasses).toEqual([1, 2])
    expect(store.map.get('positions')).toBe(T0 + 30 * MIN)
  })

  it('runs positions out of cadence while a mandate has no positions, unless positions are off', async () => {
    let needed = true
    const { fake, run } = setup({
      passes: 3,
      needsPositions: () => needed,
      during: (step, call) => {
        if (step === 'positions' && call === 2) needed = false
      },
    })
    await run()
    // Due at pass 1 anyway; needed at pass 2, hours before it is due; neither at pass 3.
    expect(fake.calls.filter((c) => c.step === 'positions').map((c) => c.pass)).toEqual([1, 2])
    const off = setup({
      passes: 2,
      needsPositions: () => true,
      settings: { positionsIntervalSeconds: 0 },
    })
    await off.run()
    expect(off.fake.calls.map((c) => c.step)).not.toContain('positions')
  })

  it('closes a pass with prune when one is due, after the chain steps', async () => {
    let due = true
    const { fake, run } = setup({
      passes: 3,
      needsPrune: () => due,
      during: (step) => {
        if (step === 'prune') due = false
      },
    })
    await run()
    expect(fake.byPass(1)).toEqual([
      'snapshot',
      'volume',
      'score',
      'positions',
      'discover',
      'prune',
    ])
    expect(fake.byPass(2)).toEqual(['snapshot', 'score', 'discover'])
    expect(fake.byPass(3)).toEqual(['snapshot', 'volume', 'score', 'discover'])
    expect(fake.maxActive()).toBe(1)
  })

  it('keeps the cadence across a restart through the store', async () => {
    const first = setup({ passes: 1 })
    await first.run()
    expect(first.store.map.get('volume')).toBe(T0)
    const restarted = fakeSteps(first.clock)
    await runScheduler({
      settings: SCHEDULE_DEFAULTS,
      steps: restarted.steps,
      store: first.store,
      log: createLogger({ level: 'silent' }),
      signal: new AbortController().signal,
      clock: first.clock,
      maxPasses: 1,
    })
    // Minutes later, in a new process: volume and positions are not due yet.
    expect(restarted.calls.map((c) => c.step)).toEqual(['seed', 'snapshot', 'score', 'discover'])
    expect(first.store.map.get('volume')).toBe(T0)
  })
})

describe('runScheduler: budgets', () => {
  it('cuts budgets to the time left before the next pass and skips a step under the minimum', async () => {
    const { fake, run, lines } = setup({
      passes: 2,
      minutes: { seed: 5, snapshot: 2, volume: 1, score: 0, positions: 10 },
    })
    await run()
    const [positions, discover] = fake.calls.filter((c) => c.pass === 1).slice(-2)
    expect(positions).toMatchObject({ step: 'positions', budgetMs: 10 * MIN })
    // 5 + 2 + 1 + 0 + 10 minutes gone of 30: 12 left, under the 15-minute discover budget.
    expect(discover).toMatchObject({ step: 'discover', budgetMs: 12 * MIN })

    const tight = setup({ passes: 1, minutes: { seed: 0, snapshot: 29.75 } })
    await tight.run()
    expect(tight.fake.byPass(1)).toEqual(['snapshot', 'volume', 'score'])
    expect(MIN_BUDGET_MS).toBe(30_000)
    expect(
      tight.lines.some((l) => /no time left before the next pass step=positions/.test(l)),
    ).toBe(true)
    expect(lines.some((l) => l.includes('[discover] done'))).toBe(true)
  })

  it('leaves positions and log discovery out when they are off', async () => {
    const { fake, run } = setup({
      passes: 2,
      settings: { positionsIntervalSeconds: 0, discoverBudgetSeconds: 0 },
    })
    await run()
    expect(fake.calls.map((c) => c.step)).not.toContain('positions')
    expect(fake.calls.map((c) => c.step)).not.toContain('discover')
  })
})

describe('runScheduler: failures and shutdown', () => {
  it('logs a failing step, carries on with the pass and tries it again at its next slot', async () => {
    const { fake, run, lines } = setup({
      passes: 3,
      fail: (step, call) => (step === 'snapshot' || step === 'volume') && call === 1,
    })
    await run()
    expect(fake.byPass(1)).toEqual(['snapshot', 'volume', 'score', 'positions', 'discover'])
    expect(fake.byPass(2)).toEqual(['snapshot', 'score', 'discover'])
    // Volume failed at pass 1 and is due again one interval later.
    expect(fake.byPass(3)).toContain('volume')
    const errors = lines.filter((l) => l.includes('ERROR'))
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatch(/\[snapshot\] failed; tried again at its next slot .*snapshot broke/)
    expect(lines.some((l) => /pass done pass=1 .*failed=\[snapshot,volume\]/.test(l))).toBe(true)
  })

  it('a failing seed is tried again at the next pass', async () => {
    const { fake, run } = setup({ passes: 2, fail: (step, call) => step === 'seed' && call === 1 })
    await run()
    expect(fake.calls.filter((c) => c.step === 'seed')).toHaveLength(2)
  })

  it('stops after the step in flight when the signal aborts, recording nothing', async () => {
    let controller: AbortController | undefined
    const ctx = setup({
      passes: 5,
      during: (step, call) => {
        if (step === 'volume' && call === 1) controller?.abort()
      },
      fail: (step) => step === 'volume' && controller?.signal.aborted === true,
    })
    controller = ctx.controller
    expect(await ctx.run()).toBe(1)
    expect(ctx.fake.calls.map((c) => c.step)).toEqual(['seed', 'snapshot', 'volume'])
    expect(ctx.store.map.has('volume')).toBe(false)
    expect(ctx.lines.some((l) => l.includes('[volume] stopped for shutdown'))).toBe(true)
    expect(ctx.lines.some((l) => l.includes('ERROR'))).toBe(false)
  })

  it('reports a step that returns after the signal aborted as stopped, recording nothing', async () => {
    let controller: AbortController | undefined
    const ctx = setup({
      passes: 5,
      during: (step) => {
        if (step === 'volume') controller?.abort()
      },
    })
    controller = ctx.controller
    expect(await ctx.run()).toBe(1)
    expect(ctx.fake.calls.map((c) => c.step)).toEqual(['seed', 'snapshot', 'volume'])
    expect(ctx.store.map.has('volume')).toBe(false)
    expect(ctx.lines.some((l) => l.includes('[volume] stopped for shutdown'))).toBe(true)
    expect(ctx.lines.some((l) => l.includes('[volume] done'))).toBe(false)
  })
})

describe('runScheduler: request accounting', () => {
  it('logs each step with its requests and units and a total once the UTC day turns', async () => {
    const clock = fakeClock(Date.UTC(2026, 9, 25, 23, 40, 0))
    const meter = new RequestMeter(
      { main: 'https://base-mainnet.g.alchemy.com/v2/key', logs: 'https://mainnet.base.org' },
      clock.now(),
    )
    const fake = fakeSteps(clock, {
      during: (step) => {
        if (step === 'snapshot') meter.record({ endpoint: 'main', method: 'eth_call' })
        if (step === 'discover') meter.record({ endpoint: 'logs', method: 'eth_getLogs' })
      },
    })
    const lines: string[] = []
    await runScheduler({
      settings: SCHEDULE_DEFAULTS,
      steps: fake.steps,
      store: memoryStore(),
      log: createLogger({ write: (line) => lines.push(line), now: () => new Date(clock.now()) }),
      signal: new AbortController().signal,
      clock,
      meter,
      maxPasses: 2,
    })
    expect(
      lines.some((l) =>
        /\[snapshot\] done ms=60000 call=1 requests=1 main=1 logs=0 alchemyCu=26/.test(l),
      ),
    ).toBe(true)
    expect(
      lines.some((l) => /\[discover\] done .*requests=1 main=0 logs=1 alchemyCu=0/.test(l)),
    ).toBe(true)
    const daily = lines.filter((l) => l.includes('daily total'))
    expect(daily).toHaveLength(1)
    expect(daily[0]).toMatch(/day=2026-10-25 requests=2 main=1 logs=1 alchemyCu=26/)
  })
})
