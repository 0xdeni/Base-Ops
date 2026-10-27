/**
 * Structured console logging for the CLI: one line per event with an ISO timestamp, a level, the
 * pipeline step in brackets and `key=value` fields (bigints as decimal strings). Lines go to
 * stderr by default so stdout stays free for machine-readable output (the serve/demo URL, the
 * output of `mm register`, `mm list` and `mm show`). Error text is the one place a URL reaches a
 * log line or stderr (viem names the endpoint in its messages), so `errorMessage` cuts every URL
 * to its origin: RPC URLs carry API keys, webhook URLs carry tokens. It also leaves out the
 * request bodies viem puts in its messages (a multicall's calldata), keeping the method.
 */
import { errorSummary, redactUrls } from '@depthwatch/chain'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
export type LogFields = Record<string, unknown>

export interface Logger {
  readonly level: LogLevel
  readonly step: string | undefined
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** A logger whose lines carry `[step]`. */
  child(step: string): Logger
  /** Runs `fn` with a child logger, logging start and end (with elapsed ms) of the step. */
  timed<T>(
    step: string,
    fn: (log: Logger) => Promise<T>,
    summary?: (result: T) => LogFields,
  ): Promise<T>
}

export interface LoggerOptions {
  level?: LogLevel
  /** Receives each formatted line; defaults to `process.stderr`. */
  write?: (line: string) => void
  now?: () => Date
  step?: string
}

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
})

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LEVEL_RANK, value)
}

/**
 * One-line message of an unknown error value: the error and its causes (chain `errorSummary`),
 * viem errors shortened to status, endpoint origin, JSON-RPC method and provider details (never the
 * request body or calldata), every URL cut to its origin (see the header).
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error || typeof error === 'string') return errorSummary(error)
  try {
    return redactUrls(JSON.stringify(error))
  } catch {
    return redactUrls(String(error))
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(4)
  }
  if (typeof value === 'string') return /[\s="]/.test(value) ? JSON.stringify(value) : value
  if (value === null || value === undefined) return 'null'
  if (value instanceof Error) return JSON.stringify(errorMessage(value))
  if (Array.isArray(value)) return `[${value.map(formatValue).join(',')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function formatFields(fields: LogFields): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ')
}

export function formatLine(
  at: Date,
  level: LogLevel,
  step: string | undefined,
  message: string,
  fields?: LogFields,
): string {
  const prefix = step ? `[${step}] ` : ''
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${formatFields(fields)}` : ''
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} ${prefix}${message}${suffix}`
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`))
  const now = options.now ?? (() => new Date())
  const step = options.step
  const threshold = LEVEL_RANK[level]

  const emit = (lineLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_RANK[lineLevel] < threshold) return
    write(formatLine(now(), lineLevel, step, message, fields))
  }

  const logger: Logger = {
    level,
    step,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (childStep) =>
      createLogger({ level, write, now, step: step ? `${step}/${childStep}` : childStep }),
    async timed(childStep, fn, summary) {
      const child = logger.child(childStep)
      const started = now().getTime()
      child.info('start')
      try {
        const result = await fn(child)
        child.info('done', { ms: now().getTime() - started, ...(summary ? summary(result) : {}) })
        return result
      } catch (error) {
        child.error('failed', { ms: now().getTime() - started, error: errorMessage(error) })
        throw error
      }
    },
  }
  return logger
}

export const silentLogger: Logger = createLogger({ level: 'silent', write: () => {} })

/**
 * `log` with its info lines demoted to debug (warnings and errors untouched): for steps that run
 * many times in a row, such as the demo's history points, whose per-step lines would drown the
 * log at the default level.
 */
export function quietLogger(log: Logger): Logger {
  const quiet: Logger = {
    level: log.level,
    step: log.step,
    debug: (message, fields) => log.debug(message, fields),
    info: (message, fields) => log.debug(message, fields),
    warn: (message, fields) => log.warn(message, fields),
    error: (message, fields) => log.error(message, fields),
    child: (step) => quietLogger(log.child(step)),
    timed: (step, fn) => fn(quietLogger(log.child(step))),
  }
  return quiet
}
