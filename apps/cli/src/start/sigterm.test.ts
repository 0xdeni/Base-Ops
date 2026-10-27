/**
 * `depthwatch start` as a real process, the way a server runs it: the synthetic Base world is
 * served over JSON-RPC from a local HTTP server (loopback only, no network), the child process
 * listens, indexes and serves, and SIGTERM makes it exit 0 well within Docker's 10 s stop timeout.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeRpcFetch, createSyntheticFixture } from '@depthwatch/chain'
import { DEXES } from '@depthwatch/core'
import { openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncKeys } from '../pipeline/context.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const MAIN = join(HERE, '..', 'main.ts')
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

/** The synthetic world behind a JSON-RPC endpoint on 127.0.0.1. */
async function rpcServer(): Promise<{ url: string; server: Server }> {
  const rpc = createFakeRpcFetch(createSyntheticFixture())
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      const response = await rpc.fetch(`http://rpc${req.url ?? '/'}`, {
        method: 'POST',
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(response.status, { 'content-type': 'application/json' })
      res.end(await response.text())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => server.closeAllConnections())
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, server }
}

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

interface Child {
  child: ChildProcess
  exited: Promise<number | null>
  stdout: () => string
  stderr: () => string
}

/** `depthwatch start` in an empty working directory (no ./.env), against `rpcUrl`. */
function startProcess(rpcUrl: string, env: Record<string, string> = {}): Child {
  const cwd = mkdtempSync(join(tmpdir(), 'depthwatch-start-'))
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }))
  const child = spawn(process.execPath, [TSX, MAIN, 'start'], {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      DEPTHWATCH_RPC_URL: `${rpcUrl}/main`,
      DEPTHWATCH_LOGS_RPC_URL: `${rpcUrl}/logs`,
      DEPTHWATCH_DB: ':memory:',
      DEPTHWATCH_PORT: '0',
      DEPTHWATCH_HOST: '127.0.0.1',
      DEPTHWATCH_LOG_CHUNK: '100000',
      DEPTHWATCH_SHUTDOWN_GRACE: '5',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cleanup.push(() => child.kill('SIGKILL'))
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  return { child, exited, stdout: () => stdout, stderr: () => stderr }
}

async function listeningUrl(child: Child): Promise<string> {
  let base = ''
  await vi.waitFor(
    () => {
      const match = /Depthwatch listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(child.stdout())
      expect(match).not.toBeNull()
      base = match?.[1] ?? ''
    },
    { timeout: 20_000, interval: 100 },
  )
  return base
}

/** SIGTERM, then the exit code and how long the process took to exit. */
async function stop(child: Child): Promise<{ code: number | null; ms: number }> {
  const stopped = Date.now()
  child.child.kill('SIGTERM')
  const code = await child.exited
  return { code, ms: Date.now() - stopped }
}

describe('depthwatch start as a process', () => {
  it('serves, indexes from a seeded database, and exits 0 on SIGTERM', async () => {
    const { url: rpcUrl, server } = await rpcServer()
    cleanup.push(() => server.close())
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    // A database seeded before (the synthetic world has no factory views to seed from).
    const dbPath = join(dir, 'live.db')
    const db = openDatabase(dbPath)
    for (const dex of DEXES) db.syncState.setBigInt(syncKeys.seed(dex), 1n)
    db.close()
    const child = startProcess(rpcUrl, { DEPTHWATCH_DB: dbPath })
    const base = await listeningUrl(child)
    // The first pass discovers the six synthetic pools through the logs endpoint.
    await vi.waitFor(
      async () => {
        const health = (await (await fetch(`${base}/api/health`)).json()) as { poolCount: number }
        expect(health.poolCount).toBe(6)
      },
      { timeout: 20_000, interval: 200 },
    )
    const { code, ms } = await stop(child)
    expect(code).toBe(0)
    expect(ms).toBeLessThan(5_000)
    expect(child.stderr()).toMatch(/\[discover\] done .*found=6 /)
    expect(child.stderr()).toContain('shutting down graceMs=5000')
  }, 60_000)

  it('stops a step waiting in a backoff at once on SIGTERM and exits 0', async () => {
    const { url: rpcUrl, server } = await rpcServer()
    cleanup.push(() => server.close())
    // An empty database: the seed's factory views miss the synthetic fixture, so it backs off.
    const child = startProcess(rpcUrl)
    await listeningUrl(child)
    await vi.waitFor(() => expect(child.stderr()).toContain('rpc backoff'), {
      timeout: 20_000,
      interval: 100,
    })
    const { code, ms } = await stop(child)
    expect(code).toBe(0)
    expect(ms).toBeLessThan(3_000)
    expect(child.stderr()).toContain('[seed] stopped for shutdown')
    expect(child.stderr()).not.toContain('abandoning')
  }, 60_000)
})
