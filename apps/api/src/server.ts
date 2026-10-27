/**
 * `startServer` binds the app to a port with `@hono/node-server`. It resolves once the server is
 * listening (so `port: 0` yields the real port) and the returned `close()` tears everything down.
 */
import type { AddressInfo } from 'node:net'
import type { Database } from '@depthwatch/db'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { type CreateAppOptions, createApp } from './app.js'

export interface StartServerOptions extends CreateAppOptions {
  db: Database
  /** 0 picks a free port. */
  port: number
  /** Defaults to 0.0.0.0 (every interface). */
  hostname?: string
}

export interface RunningServer {
  app: Hono
  port: number
  hostname: string
  /** `http://<host>:<port>` usable from the local machine. */
  url: string
  /** Stops accepting connections, drops open ones and resolves once the server is closed. */
  close(): Promise<void>
}

function urlHost(address: string): string {
  if (address === '0.0.0.0' || address === '::') return 'localhost'
  return address.includes(':') ? `[${address}]` : address
}

export function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { db, port, hostname, ...appOptions } = options
  const app = createApp(db, appOptions)
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port, hostname: hostname ?? '0.0.0.0' },
      (info: AddressInfo) => {
        server.off('error', reject)
        let closing: Promise<void> | undefined
        const close = () => {
          closing ??= new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
            if ('closeAllConnections' in server) server.closeAllConnections()
          })
          return closing
        }
        resolve({
          app,
          port: info.port,
          hostname: info.address,
          url: `http://${urlHost(info.address)}:${info.port}`,
          close,
        })
      },
    )
    server.once('error', reject)
  })
}
