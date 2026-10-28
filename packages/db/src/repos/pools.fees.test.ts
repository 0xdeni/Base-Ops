/**
 * The pool row's fee once the pool has a snapshot: only the snapshot step writes it
 * (`setFees`, the fee column alone), and a discovery or seeding upsert keeps it while still
 * rewriting the rest of the row (`hooks` included).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import {
  FIXTURE_AERO,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
  fixtureSnapshot,
} from '../fixtures.js'

const HOOK = fixtureAddress(0x4004)
const AERO_CL = fixturePool({
  id: `aero-slipstream:${fixtureAddress(0xc1)}`,
  dex: 'aero-slipstream',
  address: fixtureAddress(0xc1),
  token0: FIXTURE_WETH,
  token1: FIXTURE_AERO,
  feePips: 465,
  tickSpacing: 50,
  hooks: HOOK,
})

describe('PoolsRepo: fees', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
    db.pools.upsertMany([AERO_CL])
  })
  afterEach(() => db.close())

  it('setFees writes the fee column alone and counts the pools whose fee changed', () => {
    db.pools.setTracked([AERO_CL.id], true)
    // A seed rewrote the hook after the snapshot step had loaded the pool.
    db.pools.upsertMany([{ ...AERO_CL, hooks: null }])
    expect(
      db.pools.setFees([
        { id: AERO_CL.id, feePips: 2_055 },
        { id: 'aero-slipstream:unknown', feePips: 1 },
      ]),
    ).toBe(1)
    const record = db.pools.getRecord(AERO_CL.id)
    expect(record?.pool).toEqual({ ...AERO_CL, hooks: null, feePips: 2_055 })
    expect(record?.tracked).toBe(true)
    expect(db.pools.setFees([{ id: AERO_CL.id, feePips: 2_055 }])).toBe(0)
    expect(db.pools.setFees([])).toBe(0)
  })

  it('an upsert keeps the fee of a pool with a snapshot and still rewrites its hooks', () => {
    db.pools.upsertMany([{ ...AERO_CL, feePips: 500 }])
    expect(db.pools.get(AERO_CL.id)?.feePips).toBe(500) // no snapshot yet: the reading is stored
    db.snapshots.insertMany([
      fixtureSnapshot({ poolId: AERO_CL.id, blockNumber: 10n, timestamp: 10, feePips: 2_055 }),
    ])
    db.pools.setFees([{ id: AERO_CL.id, feePips: 2_055 }])
    db.pools.upsertMany([{ ...AERO_CL, feePips: 465, hooks: null }])
    expect(db.pools.get(AERO_CL.id)).toEqual({ ...AERO_CL, feePips: 2_055, hooks: null })
  })
})
