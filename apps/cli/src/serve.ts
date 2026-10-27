/**
 * `serve`: the REST API plus the built dashboard (`apps/web/dist`, resolved relative to this file
 * so it works from any working directory) until the abort signal fires.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type DataSource, type RunningServer, startServer, staticDirExists } from '@depthwatch/api'
import type { Database } from '@depthwatch/db'
import { errorMessage, type Logger } from './log.js'

/** Repository root (this file lives at apps/cli/src/serve.ts). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

export function webDistDir(): string {
  return resolve(repoRoot(), 'apps', 'web', 'dist')
}

/** The built dashboard directory, or undefined when `pnpm build` has not run. */
export function resolveStaticDir(): string | undefined {
  const dir = webDistDir()
  return staticDirExists(dir) ? dir : undefined
}

export interface ServeOptions {
  db: Database
  port: number
  hostname: string
  log: Logger
  /** Clock for the API (unix seconds); the demo pins it to the synthetic chain's time. */
  now?: () => number
  /** Overrides the auto-detected dashboard directory. */
  staticDir?: string
  /**
   * Bearer token for `POST /api/mm` and `DELETE /api/mm/:id` (`DEPTHWATCH_ADMIN_TOKEN`); unset,
   * the API keeps registration disabled (403) and mandates come from `depthwatch mm register`.
   */
  adminToken?: string
  /** What the database holds, reported by `GET /api/health`; the demo passes `demo`. */
  source?: DataSource
  /** Receives the one-line "listening" announcement; defaults to stdout. */
  stdout?: (line: string) => void
  /** Called with the base URL once the server listens. */
  onListening?: (url: string) => void
}

export async function serveApi(opts: ServeOptions): Promise<RunningServer> {
  const staticDir = opts.staticDir ?? resolveStaticDir()
  const stdout = opts.stdout ?? ((line: string) => process.stdout.write(`${line}\n`))
  const server = await startServer({
    db: opts.db,
    port: opts.port,
    hostname: opts.hostname,
    staticDir,
    now: opts.now,
    adminToken: opts.adminToken,
    source: opts.source,
    onError: (error, path) =>
      opts.log.error('request failed', { path, error: errorMessage(error) }),
  })
  const dashboard = staticDir ? 'served' : 'not built (run `pnpm build` for the dashboard)'
  const registration = opts.adminToken ? 'enabled' : 'disabled (set DEPTHWATCH_ADMIN_TOKEN)'
  opts.log.info('listening', {
    url: server.url,
    api: `${server.url}/api`,
    dashboard,
    registration,
  })
  stdout(`Depthwatch listening on ${server.url} (dashboard ${dashboard})`)
  opts.onListening?.(server.url)
  return server
}

/** Resolves when `signal` aborts (immediately if it already has). */
export function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/** Serves until the signal fires, then closes the server. */
export async function serveUntilAborted(
  opts: ServeOptions & { signal: AbortSignal },
): Promise<void> {
  const server = await serveApi(opts)
  try {
    await waitForAbort(opts.signal)
    opts.log.info('shutting down')
  } finally {
    await server.close()
  }
}
