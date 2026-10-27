import { afterEach, describe, expect, it } from 'vitest'
import type { HealthResponse, PoolsResponse } from './dto.js'
import { type RunningServer, startServer } from './server.js'
import { createSeededDatabase } from './testing/seed.js'

describe('startServer', () => {
  let running: RunningServer | undefined
  afterEach(async () => {
    await running?.close()
    running = undefined
  })

  it('listens on a free port and serves the API over HTTP', async () => {
    const { db, seed } = createSeededDatabase()
    try {
      running = await startServer({ db, port: 0, hostname: '127.0.0.1', now: () => seed.now })
      expect(running.port).toBeGreaterThan(0)
      expect(running.url).toBe(`http://127.0.0.1:${running.port}`)

      const health = await fetch(`${running.url}/api/health`)
      expect(health.status).toBe(200)
      expect(((await health.json()) as HealthResponse).poolCount).toBe(7)

      const pools = await fetch(`${running.url}/api/pools?limit=1`)
      const body = (await pools.json()) as PoolsResponse
      expect(body.total).toBe(6)
      expect(body.items[0]?.pool.id).toBe(seed.pools.wethUsdcV3.id)

      const missing = await fetch(`${running.url}/nothing-here`)
      expect(missing.status).toBe(404)
    } finally {
      await running?.close()
      running = undefined
      db.close()
    }
  })

  it('passes adminToken through to the app', async () => {
    const { db, seed } = createSeededDatabase()
    try {
      running = await startServer({
        db,
        port: 0,
        hostname: '127.0.0.1',
        now: () => seed.now,
        adminToken: 'hunter2',
      })
      const id = seed.mandates.aeroBreached.id
      const denied = await fetch(`${running.url}/api/mm/${id}`, { method: 'DELETE' })
      expect(denied.status).toBe(401)
      const badge = await fetch(`${running.url}/api/mm/${id}/badge.svg`)
      expect(badge.status).toBe(200)
      expect(badge.headers.get('content-type')).toBe('image/svg+xml')
      const deleted = await fetch(`${running.url}/api/mm/${id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer hunter2' },
      })
      expect(deleted.status).toBe(200)
      expect(db.mandates.get(id)).toBeUndefined()
    } finally {
      await running?.close()
      running = undefined
      db.close()
    }
  })

  it('close() stops the listener and is idempotent', async () => {
    const { db } = createSeededDatabase()
    try {
      running = await startServer({ db, port: 0, hostname: '127.0.0.1' })
      const url = running.url
      await running.close()
      await running.close()
      running = undefined
      await expect(fetch(`${url}/api/health`)).rejects.toThrow()
    } finally {
      db.close()
    }
  })

  it('rejects when the port is taken', async () => {
    const { db } = createSeededDatabase()
    try {
      running = await startServer({ db, port: 0, hostname: '127.0.0.1' })
      await expect(
        startServer({ db, port: running.port, hostname: '127.0.0.1' }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      await running?.close()
      running = undefined
      db.close()
    }
  })
})
