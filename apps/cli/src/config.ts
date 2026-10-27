/**
 * CLI arguments and environment → `Config`. Flags win over environment variables, which win over
 * the defaults below; nothing here touches the network or the database. The variables and their
 * flags are the README "Environment" table (endpoints: rpc.ts); DEPTHWATCH_ADMIN_TOKEN is
 * environment only, so it never appears in a process list.
 */
import { parseArgs } from 'node:util'
import { DEXES, type Dex } from '@depthwatch/core'
import { isLogLevel, type LogLevel } from './log.js'

export const COMMANDS = [
  'discover',
  'snapshot',
  'volume',
  'positions',
  'score',
  'run',
  'serve',
  'demo',
  'export',
  'mm',
] as const
export type Command = (typeof COMMANDS)[number]

/** Subcommands of `depthwatch mm` (market-maker scorecards, docs/design/scorecards.md §5). */
export const MM_SUBCOMMANDS = ['register', 'list', 'show', 'deactivate', 'sample'] as const
export type MmSubcommand = (typeof MM_SUBCOMMANDS)[number]

/** `mm` subcommands that take a mandate id. */
export const MM_ID_SUBCOMMANDS: readonly MmSubcommand[] = ['show', 'deactivate']
/** `mm` subcommands that read the chain and therefore need DEPTHWATCH_RPC_URL. */
export const MM_LIVE_SUBCOMMANDS: readonly MmSubcommand[] = ['sample']

/** Commands that read the chain and therefore need DEPTHWATCH_RPC_URL. */
export const LIVE_COMMANDS: readonly Command[] = [
  'discover',
  'snapshot',
  'volume',
  'positions',
  'run',
]

export const DEFAULTS = Object.freeze({
  dbPath: 'depthwatch.db',
  port: 8787,
  hostname: '0.0.0.0',
  topPools: 200,
  logChunkSize: 2_000,
  intervalSeconds: 300,
  hours: 24,
  bandPct: 5,
  concurrency: 4,
  logLevel: 'info' as LogLevel,
})

/** Usage errors (bad command, flag or value): printed on one line, exit code 2. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

export interface CliFlags {
  dex?: string[]
  fromBlock?: string
  file?: string
  publicUrl?: string
  top?: string
  pool?: string[]
  hours?: string
  interval?: string
  once?: boolean
  withPositions?: boolean
  seed?: boolean
  port?: string
  host?: string
  db?: string
  rpcUrl?: string
  logsRpcUrl?: string
  logChunk?: string
  logLevel?: string
  out?: string
  demo?: boolean
  note?: string
}

/** The `mm <subcommand> [id]` part of the command line. */
export interface MmArgs {
  subcommand: MmSubcommand
  /** The mandate id of `show` / `deactivate`; undefined for the other subcommands. */
  id: string | undefined
}

export interface CliArgs {
  command: Command | undefined
  /** Set for the `mm` command once a subcommand was given (`mm` alone leaves it undefined). */
  mm: MmArgs | undefined
  help: boolean
  version: boolean
  flags: CliFlags
}

export interface Config {
  rpcUrl: string | undefined
  /** `eth_getLogs` endpoint: DEPTHWATCH_LOGS_RPC_URL / --logs-rpc-url, else `rpcUrl`. */
  logsRpcUrl: string | undefined
  dbPath: string
  /** Where dbPath came from; `demo` only honours 'flag' and is in-memory otherwise. */
  dbPathSource: 'flag' | 'env' | 'default'
  port: number
  hostname: string
  topPools: number
  logChunkSize: number
  intervalSeconds: number
  runOnce: boolean
  withPositions: boolean
  /** `discover --seed` / `run --seed`: discovery from factory views, no logs (pipeline/seed.ts). */
  seed: boolean
  hours: number
  dexes: Dex[]
  fromBlock: bigint | undefined
  poolIds: string[]
  bandPct: number
  concurrency: number
  logLevel: LogLevel
  /** `mm register --file`: the registration JSON. */
  mandateFile: string | undefined
  /** Public base URL of this deployment (no trailing slash); undefined derives it from host/port. */
  publicUrl: string | undefined
  /** Bearer token the API requires for mandate registration; undefined keeps those routes disabled. */
  adminToken: string | undefined
  /** `export --out`: where the static bundle is written. */
  outFile: string | undefined
  /** `export --demo`: bundle the demo pipeline's in-memory database instead of the configured one. */
  exportDemo: boolean
  /** `export --note`: the bundle's `note` (trimmed), shown with a live static snapshot. */
  exportNote: string | undefined
}

export type Env = Readonly<Record<string, string | undefined>>

const PARSE_OPTIONS = {
  dex: { type: 'string', multiple: true },
  'from-block': { type: 'string' },
  file: { type: 'string' },
  'public-url': { type: 'string' },
  top: { type: 'string' },
  pool: { type: 'string', multiple: true },
  hours: { type: 'string' },
  interval: { type: 'string' },
  once: { type: 'boolean' },
  'with-positions': { type: 'boolean' },
  seed: { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  db: { type: 'string' },
  'rpc-url': { type: 'string' },
  'logs-rpc-url': { type: 'string' },
  'log-chunk': { type: 'string' },
  'log-level': { type: 'string' },
  out: { type: 'string' },
  demo: { type: 'boolean' },
  note: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value)
}

export function isMmSubcommand(value: string): value is MmSubcommand {
  return (MM_SUBCOMMANDS as readonly string[]).includes(value)
}

/**
 * The positionals after `mm`: a subcommand and, for `show` / `deactivate`, the mandate id. `mm`
 * alone yields undefined (main reports the missing subcommand as a usage error).
 */
export function parseMmArgs(
  positionals: readonly string[],
  file: string | undefined,
): MmArgs | undefined {
  const [sub, id, ...rest] = positionals
  if (sub === undefined) return undefined
  if (!isMmSubcommand(sub))
    throw new ConfigError(`unknown mm subcommand "${sub}" (one of ${MM_SUBCOMMANDS.join(', ')})`)
  if (MM_ID_SUBCOMMANDS.includes(sub)) {
    if (id === undefined) throw new ConfigError(`mm ${sub} needs a mandate id`)
    if (rest.length > 0) throw new ConfigError(`unexpected argument "${rest[0]}"`)
    return { subcommand: sub, id }
  }
  if (id !== undefined) throw new ConfigError(`unexpected argument "${id}"`)
  if (sub === 'register' && file === undefined)
    throw new ConfigError('mm register needs --file <registration json>')
  return { subcommand: sub, id: undefined }
}

/** Parses `argv` (without the node/script entries). Throws ConfigError on unknown options. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed: ReturnType<
    typeof parseArgs<{ options: typeof PARSE_OPTIONS; allowPositionals: true }>
  >
  try {
    parsed = parseArgs({
      args: [...argv],
      options: PARSE_OPTIONS,
      allowPositionals: true,
      strict: true,
    })
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error))
  }
  const { values, positionals } = parsed
  const [first, ...rest] = positionals
  let command: Command | undefined
  let mm: MmArgs | undefined
  if (first !== undefined) {
    if (!isCommand(first)) throw new ConfigError(`unknown command "${first}"`)
    command = first
  }
  if (command === 'mm') mm = parseMmArgs(rest, values.file)
  else if (rest.length > 0) throw new ConfigError(`unexpected argument "${rest[0]}"`)
  if (values.out !== undefined && values.out.trim() === '')
    throw new ConfigError('--out needs a file path')
  if (values.demo === true && command !== undefined && command !== 'export')
    throw new ConfigError('--demo only applies to export (use the demo command instead)')
  if (values.note !== undefined && command !== undefined && command !== 'export')
    throw new ConfigError('--note only applies to export')
  if (values.note !== undefined && values.note.trim() === '')
    throw new ConfigError('--note needs text')
  if (values.seed === true && command !== undefined && command !== 'discover' && command !== 'run')
    throw new ConfigError('--seed only applies to discover and run')
  if (values.seed === true && values['from-block'] !== undefined)
    throw new ConfigError('--from-block only applies to the log scan, not to --seed')
  return {
    command,
    mm,
    help: values.help === true,
    version: values.version === true,
    flags: {
      dex: values.dex,
      fromBlock: values['from-block'],
      file: values.file,
      publicUrl: values['public-url'],
      top: values.top,
      pool: values.pool,
      hours: values.hours,
      interval: values.interval,
      once: values.once,
      withPositions: values['with-positions'],
      seed: values.seed,
      port: values.port,
      host: values.host,
      db: values.db,
      rpcUrl: values['rpc-url'],
      logsRpcUrl: values['logs-rpc-url'],
      logChunk: values['log-chunk'],
      logLevel: values['log-level'],
      out: values.out,
      demo: values.demo,
      note: values.note,
    },
  }
}

interface IntBounds {
  min?: number
  max?: number
}

function parseInteger(name: string, raw: string, bounds: IntBounds = {}): number {
  const text = raw.trim()
  if (!/^-?\d+$/.test(text)) throw new ConfigError(`${name} must be an integer, got "${raw}"`)
  const value = Number(text)
  if (!Number.isSafeInteger(value)) throw new ConfigError(`${name} is out of range: "${raw}"`)
  if (bounds.min !== undefined && value < bounds.min)
    throw new ConfigError(`${name} must be ≥ ${bounds.min}, got ${value}`)
  if (bounds.max !== undefined && value > bounds.max)
    throw new ConfigError(`${name} must be ≤ ${bounds.max}, got ${value}`)
  return value
}

function parseBlock(name: string, raw: string): bigint {
  const text = raw.trim().replace(/_/g, '')
  if (!/^\d+$/.test(text)) throw new ConfigError(`${name} must be a block number, got "${raw}"`)
  return BigInt(text)
}

function pick(flag: string | undefined, env: string | undefined): string | undefined {
  if (flag !== undefined) return flag
  return env !== undefined && env.trim() !== '' ? env : undefined
}

function parseDexes(raw: readonly string[] | undefined): Dex[] {
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

function parsePoolIds(raw: readonly string[] | undefined): string[] {
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
function parseRpcUrl(name: string, raw: string | undefined): string | undefined {
  if (raw === undefined || /^https?:\/\/\S+$/i.test(raw.trim())) return raw?.trim()
  const scheme = /^([a-z][\w+.-]*):/i.exec(raw.trim())?.[1]?.toLowerCase()
  const got = scheme === undefined ? 'no scheme' : `a ${scheme}: URL`
  const ws = scheme === 'ws' || scheme === 'wss' ? ' (WebSocket endpoints are not supported)' : ''
  throw new ConfigError(`${name} must be an http(s) URL, got ${got}${ws}`)
}

/** An http(s) base URL without its trailing slash. */
function parsePublicUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (!/^https?:\/\/[^\s/]+/i.test(value))
    throw new ConfigError(`DEPTHWATCH_PUBLIC_URL must be an http(s) URL, got "${raw}"`)
  return value.replace(/\/+$/, '')
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return DEFAULTS.logLevel
  const value = raw.trim().toLowerCase()
  if (!isLogLevel(value))
    throw new ConfigError(`log level must be debug, info, warn, error or silent, got "${raw}"`)
  return value
}

export function loadConfig(env: Env, flags: CliFlags = {}): Config {
  const port = pick(flags.port, env.DEPTHWATCH_PORT)
  const top = pick(flags.top, env.DEPTHWATCH_TOP_POOLS)
  const chunk = pick(flags.logChunk, env.DEPTHWATCH_LOG_CHUNK)
  const rpcUrl = parseRpcUrl('DEPTHWATCH_RPC_URL', pick(flags.rpcUrl, env.DEPTHWATCH_RPC_URL))
  const logsRpcUrl = parseRpcUrl(
    'DEPTHWATCH_LOGS_RPC_URL',
    pick(flags.logsRpcUrl, env.DEPTHWATCH_LOGS_RPC_URL),
  )
  const envDb = pick(undefined, env.DEPTHWATCH_DB)
  return {
    rpcUrl,
    logsRpcUrl: logsRpcUrl ?? rpcUrl,
    dbPath: flags.db ?? envDb ?? DEFAULTS.dbPath,
    dbPathSource: flags.db !== undefined ? 'flag' : envDb !== undefined ? 'env' : 'default',
    port: port === undefined ? DEFAULTS.port : parseInteger('port', port, { min: 0, max: 65_535 }),
    hostname: pick(flags.host, env.DEPTHWATCH_HOST) ?? DEFAULTS.hostname,
    topPools: top === undefined ? DEFAULTS.topPools : parseInteger('top', top, { min: 0 }),
    logChunkSize:
      chunk === undefined
        ? DEFAULTS.logChunkSize
        : parseInteger('log chunk size', chunk, { min: 1, max: 10_000_000 }),
    intervalSeconds:
      flags.interval === undefined
        ? DEFAULTS.intervalSeconds
        : parseInteger('interval', flags.interval, { min: 1, max: 86_400 * 7 }),
    runOnce: flags.once === true,
    withPositions: flags.withPositions === true,
    seed: flags.seed === true,
    hours:
      flags.hours === undefined
        ? DEFAULTS.hours
        : parseInteger('hours', flags.hours, { min: 1, max: 24 * 30 }),
    dexes: parseDexes(flags.dex),
    fromBlock:
      flags.fromBlock === undefined ? undefined : parseBlock('from-block', flags.fromBlock),
    poolIds: parsePoolIds(flags.pool),
    bandPct: DEFAULTS.bandPct,
    concurrency: DEFAULTS.concurrency,
    logLevel: parseLogLevel(pick(flags.logLevel, env.DEPTHWATCH_LOG_LEVEL)),
    mandateFile: flags.file,
    publicUrl: parsePublicUrl(pick(flags.publicUrl, env.DEPTHWATCH_PUBLIC_URL)),
    adminToken: pick(undefined, env.DEPTHWATCH_ADMIN_TOKEN),
    outFile: flags.out,
    exportDemo: flags.demo === true,
    exportNote: flags.note?.trim(),
  }
}

/**
 * The public base URL of this deployment: `DEPTHWATCH_PUBLIC_URL` when set, otherwise
 * `http://<host>:<port>` of `serve` (a wildcard interface reads as localhost, like the server's
 * own announcement).
 */
export function publicBaseUrl(config: Config): string {
  if (config.publicUrl !== undefined) return config.publicUrl
  const host =
    config.hostname === '0.0.0.0' || config.hostname === '::' ? 'localhost' : config.hostname
  return `http://${host}:${config.port}`
}

/** The dashboard page of a scorecard (`/mm/<id>`), also the `scorecardUrl` of webhook alerts. */
export function scorecardUrl(config: Config, mandateId: string): string {
  return `${publicBaseUrl(config)}/mm/${encodeURIComponent(mandateId)}`
}
