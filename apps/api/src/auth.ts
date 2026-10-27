/**
 * Bearer-token check for the admin routes (`POST /api/mm`, `DELETE /api/mm/:id`,
 * docs/design/scorecards.md §6). The token comes from `createApp({ adminToken })`
 * (`DEPTHWATCH_ADMIN_TOKEN` in the CLI); without one those routes are disabled rather than open.
 */
import { timingSafeEqual } from 'node:crypto'

export type AdminCheck = 'ok' | 'disabled' | 'unauthorized'

const BEARER_RE = /^Bearer\s+(\S+)\s*$/i

/** The token of an `Authorization: Bearer <token>` header, or undefined for anything else. */
export function bearerToken(header: string | undefined | null): string | undefined {
  if (!header) return undefined
  const match = BEARER_RE.exec(header)
  return match?.[1]
}

/** Constant-time comparison of two tokens (a length mismatch still compares something). */
export function tokensEqual(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  if (a.length !== b.length) {
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * `disabled` when no admin token is configured (403 "registration disabled"), `unauthorized`
 * when the header is missing, malformed or carries a different token (401), `ok` otherwise.
 */
export function checkAdminAuth(
  configured: string | undefined,
  authorization: string | undefined | null,
): AdminCheck {
  if (configured === undefined || configured.length === 0) return 'disabled'
  const presented = bearerToken(authorization)
  if (presented === undefined) return 'unauthorized'
  return tokensEqual(configured, presented) ? 'ok' : 'unauthorized'
}
