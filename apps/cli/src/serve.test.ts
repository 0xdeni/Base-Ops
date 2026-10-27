/**
 * `serve` wiring: the admin token from `DEPTHWATCH_ADMIN_TOKEN` reaches the API (through
 * `serveApi` and through `main`), so `POST /api/mm` answers 403 without a configured token, 401
 * with a wrong one and 201 with the right one. Servers bind to a free port on 127.0.0.1.
 */
import { openDatabase } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { silentLogger } from './log.js'
import { EXIT_OK, main } from './main.js'
import { serveApi } from './serve.js'

const TOKEN = 'serve-test-token'
const REGISTRATION = {
  id: 'acme-weth-usdc',
  name: 'ACME / WETH-USDC',
  poolId: 'uniswap-v3:0x00000000000000000000000000000000000000aa',
  marketMaker: 'ACME Markets',
  addresses: ['0x1111111111111111111111111111111111111111'],
  kpis: { minDepthUsd: 50_000 },
}

async function post(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return fetch(`${url}/api/mm`, { method: 'POST', headers, body: JSON.stringify(REGISTRATION) })
}

describe('serveApi', () => {
  it('keeps registration disabled without an admin token', async () => {
    const db = openDatabase(':memory:')
    const lines: string[] = []
    const server = await serveApi({
      db,
      port: 0,
      hostname: '127.0.0.1',
      log: silentLogger,
      stdout: (line) => lines.push(line),
    })
    try {
      expect(lines[0]).toMatch(/^Depthwatch listening on http:\/\/127\.0\.0\.1:\d+ /)
      expect((await fetch(`${server.url}/api/health`)).status).toBe(200)
      expect((await post(server.url)).status).toBe(403)
      expect((await post(server.url, TOKEN)).status).toBe(403)
      expect(db.mandates.count()).toBe(0)
    } finally {
      await server.close()
      db.close()
    }
  })

  it('hands the admin token to the API: 401 without it, 201 with it, DELETE likewise', async () => {
    const db = openDatabase(':memory:')
    const server = await serveApi({
      db,
      port: 0,
      hostname: '127.0.0.1',
      adminToken: TOKEN,
      log: silentLogger,
      stdout: () => {},
    })
    try {
      expect((await post(server.url)).status).toBe(401)
      expect((await post(server.url, 'wrong')).status).toBe(401)
      const created = await post(server.url, TOKEN)
      expect(created.status).toBe(201)
      expect((await created.json()) as { status: string }).toMatchObject({ status: 'no-data' })
      expect(db.mandates.get('acme-weth-usdc')?.poolId).toBe(REGISTRATION.poolId)
      const removed = await fetch(`${server.url}/api/mm/acme-weth-usdc`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN}` },
      })
      expect(removed.status).toBe(200)
      expect(db.mandates.count()).toBe(0)
    } finally {
      await server.close()
      db.close()
    }
  })
})

describe('depthwatch serve', () => {
  it('reads DEPTHWATCH_ADMIN_TOKEN from the environment', async () => {
    const controller = new AbortController()
    const stdout: string[] = []
    const done = main(['serve', '--port', '0', '--host', '127.0.0.1', '--db', ':memory:'], {
      env: { DEPTHWATCH_ADMIN_TOKEN: TOKEN },
      log: silentLogger,
      signal: controller.signal,
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    })
    const url = await new Promise<string>((resolve) => {
      const tick = () => {
        const match = /listening on (http:\/\/127\.0\.0\.1:\d+) /.exec(stdout[0] ?? '')
        if (match?.[1]) resolve(match[1])
        else setTimeout(tick, 20)
      }
      tick()
    })
    try {
      expect((await post(url)).status).toBe(401)
      expect((await post(url, TOKEN)).status).toBe(201)
    } finally {
      controller.abort()
    }
    expect(await done).toBe(EXIT_OK)
  })
})
