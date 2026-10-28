/**
 * The access log of `createApp({ onRequest })` (DESIGN.md "API"): one entry per answered request
 * with the method, the path, the status and the handling time. The entry never carries the query
 * string or a header, so the admin token cannot reach a log. A 401 from the admin routes
 * (`requireAdmin` in routes/mm.ts) adds why it was refused and the peer address, so an operator
 * sees token guessing.
 */
import type { Context, MiddlewareHandler } from 'hono'

/** Why `POST /api/mm` or `DELETE /api/mm/:id` answered 401. */
export type AdminAuthFailure = 'missing token' | 'wrong token'

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by the admin check when it answers 401; read by the access log. */
    adminAuthFailure: AdminAuthFailure | undefined
  }
}

export interface RequestLogEntry {
  method: string
  /** The path alone: never the query string. */
  path: string
  status: number
  /** Milliseconds from the request reaching the app to its response, rounded. */
  ms: number
  /** Set on a 401 from the admin routes. */
  authFailure?: AdminAuthFailure
  /** The peer address of a refused admin request, when the server knows it. */
  client?: string
}

export type RequestLogger = (entry: RequestLogEntry) => void

/** The peer address under `@hono/node-server` (`c.env.incoming`); undefined elsewhere. */
export function clientAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined
  const address = env?.incoming?.socket?.remoteAddress
  return typeof address === 'string' ? address : undefined
}

/** The middleware that reports every request to `onRequest` once it has been answered. */
export function accessLog(onRequest: RequestLogger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    await next()
    const entry: RequestLogEntry = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    }
    const authFailure = c.get('adminAuthFailure')
    if (authFailure !== undefined) {
      entry.authFailure = authFailure
      const client = clientAddress(c)
      if (client !== undefined) entry.client = client
    }
    onRequest(entry)
  }
}
