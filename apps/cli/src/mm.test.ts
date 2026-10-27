/**
 * `depthwatch mm …` end to end through `main` on a file database (each `main` call opens its own
 * connection, so an in-memory database would not carry state between commands), plus the usage
 * and runtime error paths with their exit codes.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Jsonified, ScorecardSummary } from '@depthwatch/core'
import { fixtureMandate, fixtureMmSample, fixturePool, openDatabase } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, parseCliArgs, publicBaseUrl, scorecardUrl } from './config.js'
import { createLogger } from './log.js'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, main, usage } from './main.js'
import { formatMandateList, listSummaries, poolIsKnown, registerMandate } from './mm.js'

interface Run {
  code: number
  stdout: string[]
  stderr: string[]
  logs: string[]
}

async function run(argv: string[], env: Record<string, string> = {}): Promise<Run> {
  const stdout: string[] = []
  const stderr: string[] = []
  const logs: string[] = []
  const log = createLogger({ write: (line) => logs.push(line), now: () => new Date(0) })
  const code = await main(argv, {
    env,
    log,
    signal: new AbortController().signal,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  })
  return { code, stdout, stderr, logs }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const README = join(HERE, '..', '..', '..', 'README.md')
const MAIN_TS = join(HERE, 'main.ts')

const POOL = fixturePool()
const REGISTRATION = {
  id: 'acme-weth-usdc',
  name: 'ACME / WETH-USDC',
  poolId: POOL.id,
  marketMaker: 'ACME Markets',
  addresses: ['0x1111111111111111111111111111111111111111'],
  kpis: { minDepthUsd: 50_000, maxSpreadBps: 30 },
  alertWebhookUrl: 'https://hooks.example/depthwatch',
}

describe('mm commands through main', () => {
  let dir = ''
  let dbFile = ''
  let mandateFile = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-mm-'))
    dbFile = join(dir, 'depthwatch.db')
    mandateFile = join(dir, 'mandate.json')
    writeFileSync(mandateFile, JSON.stringify(REGISTRATION))
    const db = openDatabase(dbFile)
    try {
      db.pools.upsertMany([POOL])
    } finally {
      db.close()
    }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('register → list → show → deactivate → show', async () => {
    const registered = await run(['mm', 'register', '--file', mandateFile, '--db', dbFile])
    expect(registered.stderr).toEqual([])
    expect(registered.code).toBe(EXIT_OK)
    expect(registered.stdout).toEqual(['http://localhost:8787/mm/acme-weth-usdc'])
    expect(registered.logs.some((l) => l.includes('mandate registered'))).toBe(true)

    const listed = await run(['mm', 'list', '--db', dbFile])
    expect(listed.code).toBe(EXIT_OK)
    expect(listed.stdout[0]).toMatch(/^id\tstatus\t/)
    expect(listed.stdout[1]).toMatch(/^acme-weth-usdc\tno-data\t-\t-\t-\t/)
    expect(listed.stdout[1]).toContain(POOL.id)
    expect(listed.stdout[1]).toContain('ACME / WETH-USDC')

    const shown = await run(['mm', 'show', 'acme-weth-usdc', '--db', dbFile])
    expect(shown.code).toBe(EXIT_OK)
    const summary = JSON.parse(shown.stdout.join('\n')) as Jsonified<ScorecardSummary>
    expect(summary.status).toBe('no-data')
    expect(summary.latest).toBeNull()
    expect(summary.mandate).toMatchObject({
      id: 'acme-weth-usdc',
      poolId: POOL.id,
      addresses: REGISTRATION.addresses,
      kpis: { minDepthUsd: 50_000, bandPct: 2, maxSpreadBps: 30, spreadNotionalUsd: 10_000 },
      // The operator's `show` masks the webhook URL (its path is a secret) to scheme and host.
      alertWebhookUrl: 'https://hooks.example/…',
      alertAfterSamples: 3,
      active: true,
    })
    expect(shown.stdout.join('\n')).not.toContain('/depthwatch"')
    expect(summary.uptime.d7).toMatchObject({ windowHours: 168, samples: 0, uptime: null })

    const deactivated = await run(['mm', 'deactivate', 'acme-weth-usdc', '--db', dbFile])
    expect(deactivated.code).toBe(EXIT_OK)
    expect(deactivated.stdout).toEqual([])
    expect(deactivated.logs.some((l) => l.includes('mandate deactivated'))).toBe(true)

    const after = await run(['mm', 'show', 'acme-weth-usdc', '--db', dbFile])
    const inactive = JSON.parse(after.stdout.join('\n')) as Jsonified<ScorecardSummary>
    expect(inactive.status).toBe('inactive')
    expect(inactive.mandate.active).toBe(false)
    const relisted = await run(['mm', 'list', '--db', dbFile])
    expect(relisted.stdout[1]).toMatch(/^acme-weth-usdc\tinactive\t/)
  })

  it('re-registering an id replaces the mandate and keeps its samples', async () => {
    await run(['mm', 'register', '--file', mandateFile, '--db', dbFile])
    const db = openDatabase(dbFile)
    try {
      db.mmSamples.insert(
        fixtureMmSample({ mandateId: 'acme-weth-usdc', poolId: POOL.id, timestamp: 1_700_000_000 }),
      )
    } finally {
      db.close()
    }
    writeFileSync(
      mandateFile,
      JSON.stringify({ ...REGISTRATION, kpis: { minDepthUsd: 75_000 }, name: 'ACME v2' }),
    )
    const again = await run(['mm', 'register', '--file', mandateFile, '--db', dbFile])
    expect(again.code).toBe(EXIT_OK)
    const check = openDatabase(dbFile)
    try {
      expect(check.mandates.count()).toBe(1)
      expect(check.mandates.get('acme-weth-usdc')).toMatchObject({
        name: 'ACME v2',
        kpis: { minDepthUsd: 75_000, maxSpreadBps: null },
      })
      expect(check.mmSamples.countFor('acme-weth-usdc')).toBe(1)
    } finally {
      check.close()
    }
  })

  it('prints the public URL from DEPTHWATCH_PUBLIC_URL or --public-url', async () => {
    const fromEnv = await run(['mm', 'register', '--file', mandateFile, '--db', dbFile], {
      DEPTHWATCH_PUBLIC_URL: 'https://depthwatch.example/',
    })
    expect(fromEnv.stdout).toEqual(['https://depthwatch.example/mm/acme-weth-usdc'])
    const fromFlag = await run([
      'mm',
      'register',
      '--file',
      mandateFile,
      '--db',
      dbFile,
      '--public-url',
      'https://dw.example/base',
      '--host',
      '10.0.0.5',
      '--port',
      '9000',
    ])
    expect(fromFlag.stdout).toEqual(['https://dw.example/base/mm/acme-weth-usdc'])
    const fromHost = await run([
      'mm',
      'register',
      '--file',
      mandateFile,
      '--db',
      dbFile,
      '--host',
      '10.0.0.5',
      '--port',
      '9000',
    ])
    expect(fromHost.stdout).toEqual(['http://10.0.0.5:9000/mm/acme-weth-usdc'])
  })

  it('exits 2 on usage errors of the mm group', async () => {
    const none = await run(['mm', '--db', dbFile])
    expect(none.code).toBe(EXIT_USAGE)
    expect(none.stderr[0]).toMatch(/^error: missing mm subcommand \(one of register, list, show/)
    expect(none.stderr[1]).toContain('--help')
    const unknown = await run(['mm', 'frobnicate', '--db', dbFile])
    expect(unknown.code).toBe(EXIT_USAGE)
    expect(unknown.stderr[0]).toBe(
      'error: unknown mm subcommand "frobnicate" (one of register, list, show, deactivate, sample)',
    )
    const noId = await run(['mm', 'show', '--db', dbFile])
    expect(noId.code).toBe(EXIT_USAGE)
    expect(noId.stderr[0]).toBe('error: mm show needs a mandate id')
    const noFile = await run(['mm', 'register', '--db', dbFile])
    expect(noFile.code).toBe(EXIT_USAGE)
    expect(noFile.stderr[0]).toMatch(/^error: mm register needs --file/)
    const extra = await run(['mm', 'list', 'extra', '--db', dbFile])
    expect(extra.code).toBe(EXIT_USAGE)
    expect(extra.stderr[0]).toBe('error: unexpected argument "extra"')
    const badUrl = await run(['mm', 'list', '--db', dbFile, '--public-url', 'depthwatch.example'])
    expect(badUrl.code).toBe(EXIT_USAGE)
    expect(badUrl.stderr[0]).toMatch(/DEPTHWATCH_PUBLIC_URL must be an http\(s\) URL/)
  })

  it('exits 1 with every validation problem for a rejected registration', async () => {
    writeFileSync(
      mandateFile,
      JSON.stringify({ ...REGISTRATION, id: 'X', addresses: [], kpis: { minDepthUsd: -1 } }),
    )
    const rejected = await run(['mm', 'register', '--file', mandateFile, '--db', dbFile])
    expect(rejected.code).toBe(EXIT_ERROR)
    expect(rejected.stderr).toHaveLength(1)
    expect(rejected.stderr[0]).toMatch(/^error: invalid mandate: /)
    expect(rejected.stderr[0]).toContain('id must match')
    expect(rejected.stderr[0]).toContain('addresses must be a non-empty array')
    expect(rejected.stderr[0]).toContain('kpis.minDepthUsd must be a number > 0')
    expect(rejected.stdout).toEqual([])
    const db = openDatabase(dbFile)
    try {
      expect(db.mandates.count()).toBe(0)
    } finally {
      db.close()
    }
  })

  it('exits 1 on a missing or malformed file and on an unknown mandate; an unknown pool warns', async () => {
    const missing = await run(['mm', 'register', '--file', join(dir, 'nope.json'), '--db', dbFile])
    expect(missing.code).toBe(EXIT_ERROR)
    expect(missing.stderr[0]).toMatch(/^error: cannot read /)
    writeFileSync(mandateFile, '{ not json')
    const malformed = await run(['mm', 'register', '--file', mandateFile, '--db', dbFile])
    expect(malformed.code).toBe(EXIT_ERROR)
    expect(malformed.stderr[0]).toMatch(/is not valid JSON/)
    writeFileSync(
      mandateFile,
      JSON.stringify({
        ...REGISTRATION,
        poolId: 'uniswap-v3:0x00000000000000000000000000000000000000ff',
      }),
    )
    // The API and the demo register mandates on pools that are not discovered yet (§5 skips
    // them at snapshot time), so the CLI does too, with a warning instead of a failure.
    const orphan = await run(['mm', 'register', '--file', mandateFile, '--db', dbFile])
    expect(orphan.code).toBe(EXIT_OK)
    expect(orphan.stderr).toEqual([])
    expect(orphan.stdout).toEqual(['http://localhost:8787/mm/acme-weth-usdc'])
    expect(orphan.logs.some((l) => l.includes('poolKnown=false'))).toBe(true)
    expect(
      orphan.logs.some(
        (l) =>
          l.includes('WARN') &&
          l.includes('not in the database yet') &&
          l.includes('pool=uniswap-v3:0x00000000000000000000000000000000000000ff'),
      ),
    ).toBe(true)
    const listed = await run(['mm', 'list', '--db', dbFile])
    expect(listed.stdout[1]).toMatch(/^acme-weth-usdc\tno-data\t/)
    const shown = await run(['mm', 'show', 'ghost', '--db', dbFile])
    expect(shown.code).toBe(EXIT_ERROR)
    expect(shown.stderr[0]).toBe('error: unknown mandate "ghost" (see "depthwatch mm list")')
    const deactivated = await run(['mm', 'deactivate', 'ghost', '--db', dbFile])
    expect(deactivated.code).toBe(EXIT_ERROR)
  })

  it('mm sample is a live command: exit 1 without an RPC url, naming the variable', async () => {
    const result = await run(['mm', 'sample', '--db', dbFile])
    expect(result.code).toBe(EXIT_ERROR)
    expect(result.stderr).toHaveLength(1)
    expect(result.stderr[0]).toMatch(/"mm sample".*DEPTHWATCH_RPC_URL/)
    // The other subcommands never need one.
    expect((await run(['mm', 'list', '--db', dbFile])).code).toBe(EXIT_OK)
  })

  it('documents the mm group in the usage text', () => {
    expect(usage()).toContain('  mm ')
    for (const line of ['register --file <json>', 'show <id>', 'deactivate <id>', 'sample'])
      expect(usage()).toContain(line)
    expect(usage()).toContain('--public-url')
  })

  it('the stdout contract in README.md and the main.ts header names every mm output', async () => {
    // "stdout carries only …": the sentence, with line wraps and ` * ` comment prefixes collapsed.
    const stdoutClaim = (text: string): string => {
      const flat = text.replace(/\n\s*\*?\s*/g, ' ')
      const claim = /stdout carries only[^.]*\./.exec(flat)?.[0]
      if (claim === undefined) throw new Error('no "stdout carries only" sentence')
      return claim
    }
    const header = /^#!.*\n(\/\*\*[\s\S]*?\*\/)/.exec(readFileSync(MAIN_TS, 'utf8'))?.[1] ?? ''
    const claims = [stdoutClaim(readFileSync(README, 'utf8')), stdoutClaim(header)]

    const writers: string[] = []
    const subcommands: [string, string[]][] = [
      ['mm register', ['mm', 'register', '--file', mandateFile, '--db', dbFile]],
      ['mm list', ['mm', 'list', '--db', dbFile]],
      ['mm show', ['mm', 'show', 'acme-weth-usdc', '--db', dbFile]],
      ['mm deactivate', ['mm', 'deactivate', 'acme-weth-usdc', '--db', dbFile]],
    ]
    for (const [name, argv] of subcommands) {
      const result = await run(argv)
      expect(result.code).toBe(EXIT_OK)
      if (result.stdout.length > 0) writers.push(name)
    }
    expect(writers).toEqual(['mm register', 'mm list', 'mm show'])
    for (const claim of claims) for (const name of writers) expect(claim).toContain(`\`${name}\``)
  })
})

describe('mm helpers', () => {
  it('parseCliArgs understands the mm positionals and --file', () => {
    expect(parseCliArgs(['mm']).mm).toBeUndefined()
    expect(parseCliArgs(['mm']).command).toBe('mm')
    expect(parseCliArgs(['mm', 'register', '--file', 'm.json'])).toMatchObject({
      command: 'mm',
      mm: { subcommand: 'register', id: undefined },
      flags: { file: 'm.json' },
    })
    expect(parseCliArgs(['mm', 'show', 'acme']).mm).toEqual({ subcommand: 'show', id: 'acme' })
    expect(parseCliArgs(['mm', 'deactivate', 'acme', '--db', 'x']).mm).toEqual({
      subcommand: 'deactivate',
      id: 'acme',
    })
    expect(parseCliArgs(['mm', 'sample']).mm).toEqual({ subcommand: 'sample', id: undefined })
    expect(() => parseCliArgs(['mm', 'show', 'a', 'b'])).toThrow(/unexpected argument "b"/)
    expect(() => parseCliArgs(['mm', 'register'])).toThrow(/needs --file/)
  })

  it('publicBaseUrl falls back to host and port, mapping wildcard hosts to localhost', () => {
    expect(publicBaseUrl(loadConfig({}))).toBe('http://localhost:8787')
    expect(publicBaseUrl(loadConfig({}, { host: '::', port: '80' }))).toBe('http://localhost:80')
    expect(publicBaseUrl(loadConfig({}, { host: '192.168.1.2' }))).toBe('http://192.168.1.2:8787')
    expect(publicBaseUrl(loadConfig({ DEPTHWATCH_PUBLIC_URL: 'https://x.example///' }))).toBe(
      'https://x.example',
    )
    expect(scorecardUrl(loadConfig({}), 'a-b')).toBe('http://localhost:8787/mm/a-b')
  })

  it('registerMandate stores a valid registration whether or not its pool is discovered', () => {
    const db = openDatabase(':memory:')
    try {
      expect(() => registerMandate(db, { ...REGISTRATION, id: 'X' }, 1)).toThrow(/invalid mandate/)
      expect(db.mandates.count()).toBe(0)
      const early = registerMandate(db, REGISTRATION, 1_700_000_000)
      expect(early.createdAt).toBe(1_700_000_000)
      expect(poolIsKnown(db, early)).toBe(false)
      expect(db.mandates.get(early.id)?.id).toBe('acme-weth-usdc')
      db.pools.upsertMany([POOL])
      expect(poolIsKnown(db, early)).toBe(true)
      expect(db.mandates.count()).toBe(1)
    } finally {
      db.close()
    }
  })

  it('registerMandate keeps the registration time of a re-registered id, like POST /api/mm', () => {
    const db = openDatabase(':memory:')
    try {
      registerMandate(db, REGISTRATION, 1_700_000_000)
      const corrected = registerMandate(
        db,
        { ...REGISTRATION, kpis: { minDepthUsd: 75_000 } },
        1_703_456_000,
      )
      expect(corrected.createdAt).toBe(1_700_000_000)
      expect(db.mandates.get('acme-weth-usdc')).toMatchObject({
        createdAt: 1_700_000_000,
        kpis: { minDepthUsd: 75_000 },
      })
      // A registration that sets createdAt itself wins.
      const dated = registerMandate(
        db,
        { ...REGISTRATION, createdAt: 1_690_000_000 },
        1_704_000_000,
      )
      expect(dated.createdAt).toBe(1_690_000_000)
      expect(db.mandates.get('acme-weth-usdc')?.createdAt).toBe(1_690_000_000)
      // A new id takes the registration time.
      expect(registerMandate(db, { ...REGISTRATION, id: 'acme-2' }, 1_705_000_000).createdAt).toBe(
        1_705_000_000,
      )
    } finally {
      db.close()
    }
  })

  it('listSummaries orders active mandates first, then by name; the list carries the status', () => {
    const db = openDatabase(':memory:')
    try {
      db.mandates.upsertMany([
        fixtureMandate({ id: 'zed', name: 'Zed', active: true }),
        fixtureMandate({ id: 'amy', name: 'Amy', active: false }),
        fixtureMandate({ id: 'bob', name: 'Bob', active: true }),
      ])
      db.mmSamples.insert(
        fixtureMmSample({ mandateId: 'bob', timestamp: 1_700_000_000, withinKpi: false }),
      )
      const summaries = listSummaries(db, 1_700_000_100)
      expect(summaries.map((s) => s.mandate.id)).toEqual(['bob', 'zed', 'amy'])
      expect(summaries.map((s) => s.status)).toEqual(['breached', 'no-data', 'inactive'])
      const lines = formatMandateList(summaries)
      expect(lines).toHaveLength(4)
      expect(lines[1]).toMatch(/^bob\tbreached\t0\.0%\t0\.0%\t2023-11-14T22:13:20\.000Z\t/)
      expect(lines[3]).toMatch(/^amy\tinactive\t-\t-\t-\t/)
    } finally {
      db.close()
    }
  })
})
