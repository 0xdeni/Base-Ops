import type { ErrorIssue } from './types.js'

/**
 * Error thrown for non-2xx API responses (and by the mock client for the same cases). `message`
 * is the API's `error` string; `issues` are the per-parameter details of a 400.
 */
export class ApiError extends Error {
  readonly status: number
  readonly issues: ErrorIssue[]

  constructor(status: number, message: string, issues: ErrorIssue[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
  }
}

/**
 * `resolveClient` found no data service to talk to (`/api/health` did not answer) and may not
 * stand in the bundled mock data: a production dashboard must never show made-up pools. The
 * message is what a reader sees (`ServiceDownState`), so it stays a plain sentence.
 */
export class ApiUnavailableError extends Error {
  constructor(message = 'The data service is not answering.') {
    super(message)
    this.name = 'ApiUnavailableError'
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
