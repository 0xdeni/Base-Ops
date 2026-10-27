/**
 * `depthwatch start` in one process over the synthetic Base world (no network): the server answers
 * before the pipeline has read anything, an empty database fills within two passes, a stop
 * signal ends a cooperative step at once or abandons a stuck one after the grace period, closing
 * the server either way, and a database the process cannot write stops the start before it
 * listens. Servers bind to a free port on 127.0.0.1.
 */
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createChainReader,
  createFixtureTransport,
  createSyntheticFixture,
} from '@depthwatch/chain'
import { IN_MEMORY, openDatabase } from '@depthwatch/db'
import { custom, type Transport } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { DEMO_LOG_CHUNK_SIZE } from '../demo.js'
import { createLogger } from '../log.js'
import { EXIT_OK, main } from '../main.js'
import { assertDatabaseWritable, type ChainHooks, startCommand } from './start.js'

const ALCHEMY = 'https://base-mainnet.g.alchemy.com/v2'

function fakeClock() {
  let t = Date.UTC(2026, 9, 25, 12, 0, 0)
  return {
    now: () => t,
    sleep: async (ms: number, signal: AbortSignal) => {
      if (!signal.aborted) t += ms
    },
  }
}

function harness(createChain: (hooks: ChainHooks) => ChainReaderLike, grace = '8', maxPasses = 2) {
  const controller = new AbortController()
  const lines: string[] = []
  const stdout: string[] = []
  const config = loadConfig(
    { DEPTHWATCH_SHUTDOWN_GRACE: grace },
    { db: ':memory:', port: '0', host: '127.0.0.1', logChunk: '100000', rpcUrl: ALCHEMY },
  )
  const done = startCommand({
    config,
    log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
    signal: controller.signal,
    stdout: (line) => stdout.push(line),
    createChain,
    clock: fakeClock(),
    maxPasses,
  })
  const url = async (): Promise<string> => {
    await vi.waitFor(() => expect(stdout).toHaveLength(1))
    const match = /http:\/\/\S+/.exec(stdout[0] ?? '')
    if (match === null) throw new Error(`no URL in ${stdout[0]}`)
    return match[0]
  }
  const waitForLine = (re: RegExp) =>
    vi.waitFor(() => expect(lines.some((line) => re.test(line))).toBe(true), { timeout: 15_000 })
  return { controller, lines, done, url, waitForLine }
}

type ChainReaderLike = ReturnType<typeof createChainReader>

/** The synthetic world behind `wrap`, with the hooks `start` hands the reader. */
function syntheticChain(hooks: ChainHooks, wrap: (inner: Transport) => Transport = (t) => t) {
  return createChainReader({
    transport: wrap(createFixtureTransport(createSyntheticFixture())),
    logChunkSize: DEMO_LOG_CHUNK_SIZE,
    ...hooks,
  })
}

async function json(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url)
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

describe('startCommand', () => {
  it('serves before the first request is answered, fills an empty database, then stops', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gated = (inner: Transport): Transport =>
      ((config: Parameters<Transport>[0]) => {
        const live = inner(config)
        const request = (async (args: unknown, options: unknown) => {
          await gate
          return (live.request as (a: unknown, o: unknown) => Promise<unknown>)(args, options)
        }) as typeof live.request
        return { ...live, request }
      }) as Transport
    const h = harness((hooks) => syntheticChain(hooks, gated))
    const base = await h.url()
    // The pipeline is stuck on its first request; the API answers from the empty database.
    expect(await json(`${base}/api/health`)).toMatchObject({ ok: true, poolCount: 0 })
    release()
    await h.waitForLine(/pass done pass=2/)
    const health = await json(`${base}/api/health`)
    expect(health.poolCount).toBeGreaterThan(0)
    expect(health.trackedCount).toBeGreaterThan(0)
    expect(health.latestSnapshotAt).not.toBeNull()
    const pools = await json(`${base}/api/pools?sort=depth`)
    expect((pools.items as unknown[]).length).toBeGreaterThan(0)

    // Every step logged one line with its requests and Alchemy units.
    expect(
      h.lines.some((l) =>
        /\[snapshot\] done ms=\d+ .*requests=\d+ main=\d+ logs=0 alchemyCu=\d+/.test(l),
      ),
    ).toBe(true)
    expect(
      h.lines.some((l) => /\[discover\] done .*found=\d+ requests=\d+ main=\d+ logs=[1-9]/.test(l)),
    ).toBe(true)
    h.controller.abort()
    await h.done
    expect(h.lines.some((l) => l.includes('shutting down graceMs=8000'))).toBe(true)
    expect(h.lines.some((l) => /usage today day=2026-10-25 requests=[1-9]/.test(l))).toBe(true)
    expect(h.lines.some((l) => l.includes('abandoning'))).toBe(false)
    await expect(fetch(`${base}/api/health`)).rejects.toThrow()
  }, 30_000)

  it('ends a step that honours the signal at once when stopped', async () => {
    const waitForAbort = (hooks: ChainHooks): Transport =>
      custom({
        request: () =>
          new Promise((_resolve, reject) => {
            hooks.signal.addEventListener('abort', () => reject(hooks.signal.reason))
          }),
      })
    const h = harness((hooks) => syntheticChain(hooks, () => waitForAbort(hooks)))
    await h.url()
    await h.waitForLine(/pass start pass=1/)
    const stopped = Date.now()
    h.controller.abort()
    await h.done
    expect(Date.now() - stopped).toBeLessThan(2_000)
    expect(h.lines.some((l) => l.includes('[seed] stopped for shutdown'))).toBe(true)
    expect(h.lines.some((l) => l.includes('abandoning'))).toBe(false)
    expect(h.lines.some((l) => l.includes('ERROR'))).toBe(false)
  })

  it('abandons a step stuck past the grace period and still closes the server', async () => {
    const stuck: Transport = custom({ request: () => new Promise(() => {}) })
    const h = harness((hooks) => syntheticChain(hooks, () => stuck), '0')
    const base = await h.url()
    await h.waitForLine(/pass start pass=1/)
    h.controller.abort()
    await h.done
    expect(h.lines.some((l) => l.includes('abandoning the step in flight graceMs=0'))).toBe(true)
    await expect(fetch(`${base}/api/health`)).rejects.toThrow()
  })
})

describe('the database write probe', () => {
  it('passes on a writable database and leaves no row behind', () => {
    const db = openDatabase(IN_MEMORY)
    try {
      expect(() => assertDatabaseWritable(db)).not.toThrow()
      expect(db.syncState.entries()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('names the path when the first write fails, as a read-only file does', () => {
    const db = openDatabase(IN_MEMORY)
    try {
      // What a root-owned file under `--user node` does: it opens and reads, and refuses writes.
      db.raw.exec('PRAGMA query_only = 1')
      expect(() => assertDatabaseWritable(db)).toThrow('database is not writable: :memory:')
    } finally {
      db.close()
    }
  })

  it.skipIf(process.getuid?.() === 0)(
    'start refuses a read-only database file before it listens',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'depthwatch-readonly-'))
      try {
        const path = join(dir, 'depthwatch.db')
        openDatabase(path).close()
        chmodSync(path, 0o444)
        const stdout: string[] = []
        const config = loadConfig({}, { db: path, port: '0', host: '127.0.0.1', rpcUrl: ALCHEMY })
        await expect(
          startCommand({
            config,
            log: createLogger({ level: 'silent' }),
            signal: new AbortController().signal,
            stdout: (line) => stdout.push(line),
            createChain: (hooks) => syntheticChain(hooks),
          }),
        ).rejects.toThrow(`database is not writable: ${path}`)
        expect(stdout).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('main start', () => {
  it('serves and exits 0 when stopped before the first pass, sending nothing', async () => {
    const stdout: string[] = []
    const controller = new AbortController()
    controller.abort()
    const code = await main(['start', '--db', ':memory:', '--port', '0', '--host', '127.0.0.1'], {
      env: { DEPTHWATCH_RPC_URL: 'http://127.0.0.1:9/never-called' },
      log: createLogger({ level: 'silent' }),
      signal: controller.signal,
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    })
    expect(code).toBe(EXIT_OK)
    expect(stdout[0]).toMatch(/^Depthwatch listening on http:\/\/127\.0\.0\.1:\d+ /)
  })
})
