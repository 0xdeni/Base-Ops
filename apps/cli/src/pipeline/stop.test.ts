/**
 * A stop signal (`depthwatch start` on SIGTERM) in the middle of a step over the synthetic Base
 * world: the step starts no further pool, ends with the signal's reason and stores nothing, so no
 * partial snapshot or volume enters the database, no cursor moves past what was stored, and the
 * logs carry neither a flood of read failures nor a discovery failure.
 */
import {
  type ChainReader,
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
} from '@depthwatch/chain'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { DEMO_LOG_CHUNK_SIZE } from '../demo.js'
import { createLogger } from '../log.js'
import { createPipelineContext, type PipelineContext, syncKeys } from './context.js'
import { discoverStep } from './discover.js'
import { snapshotStep } from './snapshot.js'
import { volumeStep } from './volume.js'

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

/** What `promise` rejected with (the test fails when it resolved). */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('resolved, but a stopped step must reject')
    },
    (error: unknown) => error,
  )
}

/** The synthetic world behind a reader that honours the stop signal, as `start` builds it. */
function stoppable() {
  const controller = new AbortController()
  const chain = createChainReader({
    transport: createFixtureTransport(createSyntheticFixture()),
    logChunkSize: DEMO_LOG_CHUNK_SIZE,
    signal: controller.signal,
  })
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  const lines: string[] = []
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const context = (reader: ChainReader): PipelineContext =>
    createPipelineContext({
      db,
      chain: reader,
      config: loadConfig({}),
      log,
      signal: controller.signal,
    })
  return { controller, chain, db, lines, context }
}

describe('a stop in the middle of a step', () => {
  it('snapshot: stores no snapshot, prices or cursor and starts no further pool', async () => {
    const w = stoppable()
    await discoverStep(w.context(w.chain))
    let reads = 0
    // `docker stop` lands while the first pool's state is being read.
    const stopping: ChainReader = {
      ...w.chain,
      readState: (pool, opts) => {
        reads++
        w.controller.abort()
        return w.chain.readState(pool, opts)
      },
    }
    const error = await rejectionOf(snapshotStep(w.context(stopping)))
    expect(w.controller.signal.aborted).toBe(true)
    expect(error).toBe(w.controller.signal.reason)
    expect(reads).toBe(1)
    expect(w.db.snapshots.count()).toBe(0)
    expect(w.db.prices.count()).toBe(0)
    expect(w.db.syncState.get(syncKeys.snapshot())).toBeUndefined()
    expect(w.lines.some((l) => l.includes('readState failed'))).toBe(false)
    expect(w.lines.some((l) => l.includes('stored snapshots'))).toBe(false)
  }, 30_000)

  it('volume: a stop that lands after the swap scan stores no buckets or cursor', async () => {
    const w = stoppable()
    const ctx = w.context(w.chain)
    await discoverStep(ctx)
    await snapshotStep(ctx)
    const readSwaps: ChainReader['readSwaps'] = async (...args) => {
      const swaps = await w.chain.readSwaps(...args)
      w.controller.abort()
      return swaps
    }
    const error = await rejectionOf(volumeStep(w.context({ ...w.chain, readSwaps })))
    expect(error).toBe(w.controller.signal.reason)
    expect(w.db.volume.count()).toBe(0)
    expect(w.db.syncState.get(syncKeys.volume())).toBeUndefined()
    expect(w.lines.some((l) => l.includes('stored hourly volume'))).toBe(false)
  }, 30_000)

  it('discover: keeps the windows done, moves no cursor further and logs no failure', async () => {
    const w = stoppable()
    const dex = loadConfig({}).dexes[0]
    if (dex === undefined) throw new Error('no dex')
    let windows = 0
    const discoverPools: ChainReader['discoverPools'] = async (...args) => {
      const pools = await w.chain.discoverPools(...args)
      if (++windows === 1) w.controller.abort()
      return pools
    }
    const error = await rejectionOf(
      discoverStep(w.context({ ...w.chain, discoverPools }), { dexes: [dex] }),
    )
    expect(error).toBe(w.controller.signal.reason)
    // The first window was stored with its cursor; the second never started.
    expect(w.db.syncState.getBigInt(syncKeys.discover(dex))).toBeDefined()
    expect(w.lines.filter((l) => l.includes(' window dex='))).toHaveLength(1)
    expect(w.lines.some((l) => l.includes('discovery failed'))).toBe(false)
    expect(w.lines.some((l) => l.includes('ERROR'))).toBe(false)
  }, 30_000)
})
