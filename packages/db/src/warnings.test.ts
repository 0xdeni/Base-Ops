import { describe, expect, it } from 'vitest'
import {
  createWarningFilter,
  installSqliteWarningFilter,
  isSqliteExperimentalWarning,
} from './warnings.js'

function warning(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

describe('sqlite warning filter', () => {
  it('recognises only the SQLite ExperimentalWarning', () => {
    expect(
      isSqliteExperimentalWarning(
        warning('ExperimentalWarning', 'SQLite is an experimental feature and might change'),
      ),
    ).toBe(true)
    expect(
      isSqliteExperimentalWarning(warning('ExperimentalWarning', 'WASI is experimental')),
    ).toBe(false)
    expect(isSqliteExperimentalWarning(warning('DeprecationWarning', 'SQLite something'))).toBe(
      false,
    )
    expect(isSqliteExperimentalWarning('SQLite')).toBe(false)
    expect(isSqliteExperimentalWarning(null)).toBe(false)
  })

  it('drops the SQLite warning and forwards everything else to the wrapped listeners', () => {
    const received: Error[] = []
    const filter = createWarningFilter([(w) => received.push(w), (w) => received.push(w)])
    filter(warning('ExperimentalWarning', 'SQLite is an experimental feature'))
    expect(received).toHaveLength(0)
    const other = warning('ExperimentalWarning', 'Something else is experimental')
    filter(other)
    expect(received).toEqual([other, other])
  })

  it('installs the process-level filter once per process', () => {
    installSqliteWarningFilter()
    expect(installSqliteWarningFilter()).toBe(false)
    const listeners = process.listeners('warning')
    expect(listeners.filter((l) => l.name === 'depthwatchSqliteWarningFilter')).toHaveLength(1)
  })
})
