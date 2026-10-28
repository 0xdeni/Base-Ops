/**
 * The snapshot step over the time-varying synthetic world with its Aero pools: the fee read with
 * each state is stored on the pool row when it moved (the Aero Slipstream hook's fee changes by
 * the hour), and only then; a swap hook or fee module that changed fails that pool's snapshot with
 * `PoolConfigChangedError`, logged with the remedy that fits the change, while every other pool is
 * stored; an empty pool (zero reserves) tracked by `--pool` is skipped, not failed.
 */
import {
  aeroCLFactoryAbi,
  aerodromePoolAbi,
  aeroHookFeeAt,
  aeroPoolFactoryAbi,
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
  type Fixture,
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
const AERO_V2 = SYNTHETIC_POOL_IDS.aeroUsdcAeroV2
const AERO_V2_ADDRESS = syntheticPoolAddress(SYNTHETIC_POOL_LABELS.aeroUsdcAeroV2)
const addresses = syntheticAddresses()
const feeAt = (t: number) => aeroHookFeeAt(SYNTHETIC_DEFAULTS.seed, 7, Math.floor(t / HOUR_SECONDS))

let db: Database
afterEach(() => db?.close())

type Patch = (fixture: Fixture, blocks: ['latest', bigint]) => void

/** The Aero Slipstream pool's swap hook replaced by `hook`. */
const swapHook =
  (hook: `0x${string}`): Patch =>
  (fixture, blocks) =>
    registerCall(fixture, {
      to: addresses.aeroSlipstream[0]?.factory as `0x${string}`,
      abi: aeroCLFactoryAbi,
      functionName: 'getPoolSwapHook',
      args: [AERO_CL_ADDRESS],
      result: hook,
      blocks,
    })

/** A context on the world at `epochTimestamp`, with `patch` applied to the chain's answers. */
function contextAt(epochTimestamp: number, lines: string[], patch?: Patch): PipelineContext {
  const fixture = createSyntheticFixture({ epochTimestamp })
  patch?.(fixture, ['latest', BigInt(fixture.clock?.latestBlock ?? '0')])
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

  it('writes only the fee back, so a seed that rewrote hooks meanwhile keeps its write', async () => {
    db = openDatabase(IN_MEMORY)
    const lines: string[] = []
    await discoverStep(contextAt(NOW - 4 * HOUR_SECONDS, lines), { windowChunks: 1_000 })
    const hook = '0x00000000000000000000000000000000000000c1'
    const ctx = contextAt(NOW, lines)
    const { chain } = ctx
    // A `discover --seed` beside `start` stores the pool as hooked while the snapshot reads it.
    const readState: typeof chain.readState = async (pool, opts) => {
      const state = await chain.readState(pool, opts)
      if (pool.id === AERO_CL) db.pools.upsertMany([{ ...pool, hooks: hook }])
      return state
    }
    const result = await snapshotStep({ ...ctx, chain: { ...chain, readState } })
    expect(result).toMatchObject({ snapshots: 8, fees: 1, failed: [] })
    expect(db.pools.get(AERO_CL)).toMatchObject({ hooks: hook, feePips: feeAt(NOW) })
  }, 20_000)

  it('fails a pool whose swap hook changed and stores every other one', async () => {
    db = openDatabase(IN_MEMORY)
    const lines: string[] = []
    await discoverStep(contextAt(NOW, lines), { windowChunks: 1_000 })
    const other = '0x00000000000000000000000000000000000000c0'
    const result = await snapshotStep(contextAt(NOW, lines, swapHook(other)))
    expect(result.snapshots).toBe(7)
    expect(result.failed).toEqual([
      { item: AERO_CL, error: `${AERO_CL}: swap hook changed (${other})` },
    ])
    expect(db.snapshots.latestForPool(AERO_CL)).toBeUndefined()
    const line = lines.find((l) => l.includes('pool configuration changed; not snapshotted'))
    expect(line).toContain('then run discover --seed, which stores the pool as hooked')
  }, 20_000)

  it('names a new build, not discover --seed, for a fee module that changed', async () => {
    db = openDatabase(IN_MEMORY)
    const lines: string[] = []
    await discoverStep(contextAt(NOW, lines), { windowChunks: 1_000 })
    const module = '0x00000000000000000000000000000000000000fe'
    const result = await snapshotStep(
      contextAt(NOW, lines, (fixture, blocks) =>
        registerCall(fixture, {
          to: addresses.aeroV2.volatileFactory,
          abi: aeroPoolFactoryAbi,
          functionName: 'feeModule',
          result: module,
          blocks,
        }),
      ),
    )
    expect(result.failed.map((f) => f.item)).toEqual([AERO_V2])
    expect(result.failed[0]?.error).toContain(`fee module changed (${module})`)
    const line = lines.find((l) => l.includes('pool configuration changed; not snapshotted'))
    expect(line).toContain('pin it in aeroV2.volatileFeeModule / stableFeeModule')
    expect(line).toContain('discover --seed does not help')
  }, 20_000)

  it('skips a requested pool with zero reserves without failing it', async () => {
    db = openDatabase(IN_MEMORY)
    const lines: string[] = []
    await discoverStep(contextAt(NOW, lines), { windowChunks: 1_000 })
    const empty: Patch = (fixture, blocks) =>
      registerCall(fixture, {
        to: AERO_V2_ADDRESS,
        abi: aerodromePoolAbi,
        functionName: 'getReserves',
        result: [0n, 0n, BigInt(NOW)],
        blocks,
      })
    const result = await snapshotStep(contextAt(NOW, lines, empty), { poolIds: [AERO_V2] })
    expect(result).toMatchObject({ snapshots: 7, empty: 1, failed: [] })
    expect(db.snapshots.latestForPool(AERO_V2)).toBeUndefined()
    expect(lines.some((l) => l.endsWith(`INFO  empty pool, not snapshotted pool=${AERO_V2}`))).toBe(
      true,
    )
  }, 20_000)
})
