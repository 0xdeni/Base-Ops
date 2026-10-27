/**
 * Parsers of single configuration values (flags and environment variables) for config.ts and
 * start/settings.ts. Each throws a ConfigError naming the setting; none echoes an RPC URL.
 */
import { DEXES, type Dex } from '@depthwatch/core'
import { isLogLevel, type LogLevel } from './log.js'

/** Environment variables (`process.env` or a test's object). */
export type Env = Readonly<Record<string, string | undefined>>

/** Usage errors (bad command, flag or value): printed on one line, exit code 2. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

export interface IntBounds {
  min?: number
  max?: number
}

function checkBounds(name: string, value: number, bounds: IntBounds, unit = ''): number {
  if (bounds.min !== undefined && value < bounds.min)
    throw new ConfigError(`${name} must be ≥ ${bounds.min}${unit}, got ${value}${unit}`)
  if (bounds.max !== undefined && value > bounds.max)
    throw new ConfigError(`${name} must be ≤ ${bounds.max}${unit}, got ${value}${unit}`)
  return value
}

export function parseInteger(name: string, raw: string, bounds: IntBounds = {}): number {
  const text = raw.trim()
  if (!/^-?\d+$/.test(text)) throw new ConfigError(`${name} must be an integer, got "${raw}"`)
  const value = Number(text)
  if (!Number.isSafeInteger(value)) throw new ConfigError(`${name} is out of range: "${raw}"`)
  return checkBounds(name, value, bounds)
}

const DURATION_RE = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/

export interface DurationBounds extends IntBounds {
  /** Accept `off` (and 0) as "disabled", returned as 0. */
  off?: boolean
}

/**
 * A duration in seconds: a plain integer is seconds (as `run --interval 300` always took), or
 * units such as `90s`, `30m`, `6h`, `1d`, `1h30m`. With `bounds.off`, `off` and `0` give 0.
 */
export function parseDuration(name: string, raw: string, bounds: DurationBounds = {}): number {
  const text = raw.trim().toLowerCase()
  const allowed = bounds.off ? '; or off' : ''
  if (bounds.off && (text === 'off' || text === '0')) return 0
  let seconds: number | undefined
  if (/^\d+$/.test(text)) seconds = Number(text)
  else {
    const match = DURATION_RE.exec(text)
    if (match !== null && text !== '') {
      const [d = 0, h = 0, m = 0, s = 0] = match.slice(1).map((part) => Number(part ?? 0))
      seconds = ((d * 24 + h) * 60 + m) * 60 + s
    }
  }
  if (seconds === undefined || !Number.isSafeInteger(seconds))
    throw new ConfigError(
      `${name} must be a duration such as 90s, 30m or 6h (a plain number is seconds)${allowed}, got "${raw}"`,
    )
  return checkBounds(name, seconds, bounds, ' s')
}

export function parseBlock(name: string, raw: string): bigint {
  const text = raw.trim().replace(/_/g, '')
  if (!/^\d+$/.test(text)) throw new ConfigError(`${name} must be a block number, got "${raw}"`)
  return BigInt(text)
}

/** The flag when given, else a non-blank environment value. */
export function pick(flag: string | undefined, env: string | undefined): string | undefined {
  if (flag !== undefined) return flag
  return env !== undefined && env.trim() !== '' ? env : undefined
}

export function parseDexes(raw: readonly string[] | undefined): Dex[] {
  if (raw === undefined || raw.length === 0) return [...DEXES]
  const out: Dex[] = []
  for (const entry of raw.flatMap((value) => value.split(','))) {
    const name = entry.trim().toLowerCase()
    if (name === '') continue
    if (!(DEXES as readonly string[]).includes(name))
      throw new ConfigError(`unknown dex "${entry}" (expected one of ${DEXES.join(', ')})`)
    if (!out.includes(name as Dex)) out.push(name as Dex)
  }
  return out.length > 0 ? out : [...DEXES]
}

export function parsePoolIds(raw: readonly string[] | undefined): string[] {
  if (raw === undefined) return []
  const out: string[] = []
  for (const entry of raw.flatMap((value) => value.split(','))) {
    const id = entry.trim()
    if (id === '') continue
    if (!id.includes(':')) throw new ConfigError(`pool id "${id}" must look like <dex>:<address>`)
    const [dex, key] = id.split(':', 2)
    const normalized = `${dex}:${(key ?? '').toLowerCase()}`
    if (!out.includes(normalized)) out.push(normalized)
  }
  return out
}

/** An http(s) URL (the reader's transports are HTTP only), never echoed: RPC URLs carry keys. */
export function parseRpcUrl(name: string, raw: string | undefined): string | undefined {
  if (raw === undefined || /^https?:\/\/\S+$/i.test(raw.trim())) return raw?.trim()
  const scheme = /^([a-z][\w+.-]*):/i.exec(raw.trim())?.[1]?.toLowerCase()
  const got = scheme === undefined ? 'no scheme' : `a ${scheme}: URL`
  const ws = scheme === 'ws' || scheme === 'wss' ? ' (WebSocket endpoints are not supported)' : ''
  throw new ConfigError(`${name} must be an http(s) URL, got ${got}${ws}`)
}

/** An http(s) base URL without its trailing slash. */
export function parsePublicUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (!/^https?:\/\/[^\s/]+/i.test(value))
    throw new ConfigError(`DEPTHWATCH_PUBLIC_URL must be an http(s) URL, got "${raw}"`)
  return value.replace(/\/+$/, '')
}

export function parseLogLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (raw === undefined) return fallback
  const value = raw.trim().toLowerCase()
  if (!isLogLevel(value))
    throw new ConfigError(`log level must be debug, info, warn, error or silent, got "${raw}"`)
  return value
}
