/**
 * What every route handler gets: the database, a clock (injectable so tests are deterministic)
 * and the optional admin token that guards mandate registration.
 */
import type { Database } from '@depthwatch/db'
import type { DataSource } from './dto.js'

export interface ApiContext {
  db: Database
  /** Unix seconds. */
  now: () => number
  /**
   * Bearer token required by `POST /api/mm` and `DELETE /api/mm/:id`. Undefined (or empty) means
   * registration over the API is disabled and those routes answer 403.
   */
  adminToken?: string
  /** `demo` when the database is the synthetic demo world; reported by `GET /api/health`. */
  source: DataSource
}

export const DAY_SECONDS = 86_400

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unknown error'
}
