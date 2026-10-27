/**
 * node:sqlite prints `ExperimentalWarning: SQLite is an experimental feature …` on Node 22 the
 * first time the module is loaded. Depthwatch opts into that API knowingly, so the warning is
 * filtered out of the process 'warning' event stream — once per process, before the module loads.
 */

export type WarningListener = (warning: Error) => void

const INSTALLED = Symbol.for('depthwatch.db.sqliteWarningFilter')

export function isSqliteExperimentalWarning(warning: unknown): boolean {
  return (
    warning instanceof Error &&
    warning.name === 'ExperimentalWarning' &&
    warning.message.includes('SQLite')
  )
}

/** Wraps the existing 'warning' listeners so the SQLite warning never reaches them. */
export function createWarningFilter(downstream: readonly WarningListener[]): WarningListener {
  return function depthwatchSqliteWarningFilter(warning: Error): void {
    if (isSqliteExperimentalWarning(warning)) return
    for (const listener of downstream) listener.call(process, warning)
  }
}

/**
 * Replaces the process 'warning' listeners (Node's default printer included) with a filtering
 * wrapper. Idempotent per process; returns true when it installed the filter.
 */
export function installSqliteWarningFilter(): boolean {
  const flags = globalThis as Record<symbol, unknown>
  if (flags[INSTALLED]) return false
  flags[INSTALLED] = true
  const existing = process.listeners('warning')
  process.removeAllListeners('warning')
  process.on('warning', createWarningFilter(existing))
  return true
}
