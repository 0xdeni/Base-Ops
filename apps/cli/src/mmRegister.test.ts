/**
 * `depthwatch mm register` input rules: a mixed-case pool id is stored lowercase and so matches
 * the discovered pool, a malformed one is a validation error (exit 1), and registering a
 * deactivated mandate again keeps it deactivated unless the file sets `"active": true`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixturePool, openDatabase } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from './log.js'
import { EXIT_ERROR, EXIT_OK, main } from './main.js'
import { poolIsKnown, registerMandate } from './mm.js'

/** A pool whose address has hex letters, so its checksummed form differs from the stored id. */
const POOL = fixturePool({ address: '0xd0b53d9277642d899df5c87a3966a349a798f224' })
const CHECKSUMMED = 'uniswap-v3:0xD0B53D9277642d899DF5C87A3966A349A798F224'
const REGISTRATION = {
  id: 'acme-weth-usdc',
  name: 'ACME / WETH-USDC',
  poolId: CHECKSUMMED,
  marketMaker: 'ACME Markets',
  addresses: ['0x1111111111111111111111111111111111111111'],
  kpis: { minDepthUsd: 50_000 },
}

async function run(argv: string[]): Promise<{ code: number; stderr: string[]; logs: string[] }> {
  const stderr: string[] = []
  const logs: string[] = []
  const code = await main(argv, {
    env: {},
    log: createLogger({ write: (line) => logs.push(line), now: () => new Date(0) }),
    signal: new AbortController().signal,
    stdout: () => {},
    stderr: (line) => stderr.push(line),
  })
  return { code, stderr, logs }
}

describe('registerMandate', () => {
  it('stores a checksummed pool id lowercase, so the discovered pool is found', () => {
    const db = openDatabase(':memory:')
    try {
      db.pools.upsertMany([POOL])
      expect(POOL.id).toBe(CHECKSUMMED.toLowerCase())
      const mandate = registerMandate(db, REGISTRATION, 1_700_000_000)
      expect(mandate.poolId).toBe(POOL.id)
      expect(poolIsKnown(db, mandate)).toBe(true)
      expect(
        db.mandates
          .forPools([POOL.id])
          .get(POOL.id)
          ?.map((m) => m.id),
      ).toEqual(['acme-weth-usdc'])
    } finally {
      db.close()
    }
  })

  it('keeps a deactivated mandate deactivated; "active": true resumes it', () => {
    const db = openDatabase(':memory:')
    try {
      registerMandate(db, REGISTRATION, 1_700_000_000)
      db.mandates.setActive('acme-weth-usdc', false)
      const again = registerMandate(
        db,
        { ...REGISTRATION, kpis: { minDepthUsd: 1 } },
        1_701_000_000,
      )
      expect(again).toMatchObject({ active: false, createdAt: 1_700_000_000 })
      expect(db.mandates.get('acme-weth-usdc')?.active).toBe(false)
      expect(registerMandate(db, { ...REGISTRATION, active: true }, 1_702_000_000).active).toBe(
        true,
      )
      expect(db.mandates.get('acme-weth-usdc')?.active).toBe(true)
    } finally {
      db.close()
    }
  })
})

describe('mm register through main', () => {
  let dir = ''
  let dbFile = ''
  let file = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-mm-register-'))
    dbFile = join(dir, 'depthwatch.db')
    file = join(dir, 'mandate.json')
    const db = openDatabase(dbFile)
    try {
      db.pools.upsertMany([POOL])
    } finally {
      db.close()
    }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reports a checksummed pool id as known and rejects a malformed one', async () => {
    writeFileSync(file, JSON.stringify(REGISTRATION))
    const ok = await run(['mm', 'register', '--file', file, '--db', dbFile])
    expect(ok.code).toBe(EXIT_OK)
    expect(ok.logs.find((l) => l.includes('mandate registered'))).toContain('poolKnown=true')
    expect(ok.logs.some((l) => l.includes('not in the database yet'))).toBe(false)

    writeFileSync(file, JSON.stringify({ ...REGISTRATION, id: 'acme-2', poolId: 'uniswap-v9:0x1' }))
    const bad = await run(['mm', 'register', '--file', file, '--db', dbFile])
    expect(bad.code).toBe(EXIT_ERROR)
    expect(bad.stderr.join('\n')).toContain('poolId must be <dex>:<0x pool address>')
  })

  it('register → deactivate → register from the same file stays inactive', async () => {
    writeFileSync(file, JSON.stringify(REGISTRATION))
    expect((await run(['mm', 'register', '--file', file, '--db', dbFile])).code).toBe(EXIT_OK)
    expect((await run(['mm', 'deactivate', 'acme-weth-usdc', '--db', dbFile])).code).toBe(EXIT_OK)
    const again = await run(['mm', 'register', '--file', file, '--db', dbFile])
    expect(again.code).toBe(EXIT_OK)
    expect(again.logs.find((l) => l.includes('mandate registered'))).toContain('active=false')
    const db = openDatabase(dbFile)
    try {
      expect(db.mandates.get('acme-weth-usdc')?.active).toBe(false)
    } finally {
      db.close()
    }
  })
})
