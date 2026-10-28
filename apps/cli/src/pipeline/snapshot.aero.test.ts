/**
 * The snapshot step over the time-varying synthetic world with its Aero pools: the fee read with
 * each state is stored on the pool row when it moved (the Aero Slipstream hook's fee changes by
 * the hour), and only then; a swap hook that changed fails that pool's snapshot with
 * `PoolConfigChangedError` while every other pool is stored.
 */
import {
  aeroCLFactoryAbi,
  aeroHookFeeAt,
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
  registerCall,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_POOL_IDS,
  SYNTHETIC_POOL_LABELS,
  syntheticAddresses,
  syntheticPoolAddress,
} from '@depthwatch/chain'
import { type Database, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { DEMO_LOG_CHUNK_SIZE } from '../demo.js'
import { createLogger } from '../log.js'
import { createPipelineContext, HOUR_SECONDS, type PipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { snapshotStep } from './snapshot.js'

const NOW = SYNTHETIC_DEFAULTS.latestTimestamp
const AERO_CL = SYNTHETIC_POOL_IDS.wethUsdcAeroSlipstream
const AERO_CL_ADDRESS = syntheticPoolAddress(SYNTHETIC_POOL_LABELS.wethUsdcAeroSlipstream)
const addresses = syntheticAddresses()
const feeAt = (t: number) => aeroHookFeeAt(SYNTHETIC_DEFAULTS.seed, 7, Math.floor(t / HOUR_SECONDS))

let db: Database
afterEach(() => db?.close())

/** A context on the world at `epochTimestamp`; `hook` replaces the Aero pool's swap hook. */
function contextAt(epochTimestamp: number, lines: string[], hook?: `0x${string}`): PipelineContext {
  const fixture = createSyntheticFixture({ epochTimestamp })
  if (hook !== undefined) {
    const block = BigInt(fixture.clock?.latestBlock ?? '0')
    registerCall(fixture, {
      to: addresses.aeroSlipstream[0]?.factory as `0x${string}`,
      abi: aeroCLFactoryAbi,
      functionName: 'getPoolSwapHook',
      args: [AERO_CL_ADDRESS],
      result: hook,
      blocks: ['latest', block],
    })
  }
  const chain = createChainReader({
    transport: createFixtureTransport(fixture),
    addresses,
    logChunkSize: DEMO_LOG_CHUNK_SIZE,
  })
  return createPipelineContext({
    db,
    chain,
    config: loadConfig({}),
    log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
    now: () => epochTimestamp,
  })
}

describe('snapshotStep with Aero pools', () => {
  it('stores the fee read at each snapshot on the pool row when it moved, and only then', async () => {
    db = openDatabase(IN_MEMORY)
    const lines: string[] = []
    const first = NOW - 4 * HOUR_SECONDS
    const ctx = contextAt(first, lines)
    await discoverStep(ctx, { windowChunks: 1_000 })
    expect(db.pools.get(AERO_CL)?.feePips).toBe(feeAt(first))
    const firstSeen = db.pools.getRecord(AERO_CL)?.firstSeenAt
    const fees = new Map(db.pools.list().map((p) => [p.id, p.feePips]))

    const unchanged = await snapshotStep(ctx)
    expect(unchanged).toMatchObject({ snapshots: 8, fees: 0, failed: [] })
    expect(feeAt(NOW)).not.toBe(feeAt(first))
    const moved = await snapshotStep(contextAt(NOW, lines))
    expect(moved).toMatchObject({ snapshots: 8, fees: 1, failed: [] })
    const record = db.pools.getRecord(AERO_CL)
    expect(record?.pool.feePips).toBe(feeAt(NOW))
    expect(record?.tracked).toBe(true)
    expect(record?.firstSeenAt).toBe(firstSeen)
    // Every other pool keeps its fee: none moved.
    for (const pool of db.pools.list())
      if (pool.id !== AERO_CL) expect(pool.feePips).toBe(fees.get(pool.id))
  }, 20_000)

  it('fails a pool whose swap hook changed and stores every other one', async () => {
    db = openDatabase(IN_MEMORY)
    const lines: string[] = []
    await discoverStep(contextAt(NOW, lines), { windowChunks: 1_000 })
    const other = '0x00000000000000000000000000000000000000c0'
    const result = await snapshotStep(contextAt(NOW, lines, other))
    expect(result.snapshots).toBe(7)
    expect(result.failed).toEqual([
      { item: AERO_CL, error: `${AERO_CL}: swap hook changed (${other})` },
    ])
    expect(db.snapshots.latestForPool(AERO_CL)).toBeUndefined()
    expect(lines.some((l) => l.includes('pool configuration changed'))).toBe(true)
  }, 20_000)
})
