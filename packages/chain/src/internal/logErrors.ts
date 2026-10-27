/**
 * What an `eth_getLogs` failure means, read from the error and its `cause` chain (viem wraps the
 * provider's JSON-RPC error; `details` carries the provider's own text):
 *
 * - `rate-limit`: HTTP 429, JSON-RPC code 429 / -32007, or a rate-limit message → retry the same
 *   range after a backoff.
 * - `transient`: viem's client-side timeout, a request that never got a response, an HTTP 408 /
 *   5xx gateway answer (Cloudflare 520-524 included), JSON-RPC -32603 → retry the same range after
 *   a backoff. viem raises `HttpRequestError` only for an answer whose body is not a JSON-RPC error
 *   (a JSON-RPC error with a non-2xx status becomes an `RpcRequestError`), so such an answer comes
 *   from a proxy or gateway, never from the node rejecting the range: "upstream request timeout"
 *   on a 504 is weather, not a range limit, and is never read as one.
 * - `range`: the provider rejected the range itself (span or result size) → split it. When the
 *   message states the provider's maximum span (Alchemy free: "up to a 10 block range"), that
 *   number is returned as `statedMax`.
 * - `other`: anything else (reverts, fixture misses, bad params), and a `RetryExhaustedError`,
 *   whose retries are already spent → fail.
 */

export type LogsErrorKind = 'rate-limit' | 'transient' | 'range' | 'other'

export interface LogsErrorInfo {
  kind: LogsErrorKind
  /** Largest block span the provider says it accepts, when its message states one. */
  statedMax: bigint | undefined
  /** From a `Retry-After` header (seconds or HTTP date), in milliseconds. */
  retryAfterMs: number | undefined
  /** The provider's own message (one line, at most 300 characters). */
  providerMessage: string
}

const RANGE_ERROR_RE =
  /too many|more than \d+ (results|logs)|response size|block range|blocks range|range (is )?too (large|wide|big)|limit exceeded|exceed|query timeout|timed? ?out/i

const RATE_LIMIT_RE =
  /rate.?limit|too many requests|request limit|requests? per second|compute units|throughput|daily request count|exceeded (your |the )?quota/i

/**
 * Messages that state a maximum `eth_getLogs` span. Group 1 is the number, group 2 an optional
 * `K` / `M` multiplier (Alchemy's paid tiers: "up to a 2K block range").
 */
const STATED_MAX_RES: readonly RegExp[] = [
  // Alchemy free tier: "you can make eth_getLogs requests with up to a 10 block range"
  /up to (?:a |an )?([\d,_]+)([km])?[ -]?blocks?\b/i,
  // QuickNode: "eth_getLogs is limited to a 10,000 range" / "limited to a 10000 blocks range"
  /limited to (?:a |an )?([\d,_]+)[ -]?(?:blocks? )?range/i,
  // "exceed maximum block range: 5000", "max block range 100000", "maximum range of 1000"
  /max(?:imum)?(?: allowed)? (?:block )?range(?: is| of| size)?:? *([\d,_]+)/i,
  // "block range limit (1000)", "block range limit is 2000"
  /block range (?:limit|max(?:imum)?)(?: is| of)?:? *\(?([\d,_]+)/i,
  // dRPC: "ranges over 10000 blocks are not supported"
  /ranges? (?:over|above|greater than|larger than|exceeding) ([\d,_]+) blocks?/i,
]

/** HTTP statuses of a gateway or proxy that is busy or timed out (520-524: Cloudflare's own). */
const TRANSIENT_HTTP_STATUS: ReadonlySet<number> = new Set([
  408, 500, 502, 503, 504, 520, 521, 522, 523, 524,
])
const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([429, -32007])
const RETRY_EXHAUSTED = 'RetryExhaustedError'

interface ErrorLevel {
  name?: unknown
  code?: unknown
  status?: unknown
  message?: unknown
  shortMessage?: unknown
  details?: unknown
  headers?: unknown
  cause?: unknown
}

function levels(err: unknown): ErrorLevel[] {
  const out: ErrorLevel[] = []
  let cursor: unknown = err
  for (let depth = 0; depth < 8 && typeof cursor === 'object' && cursor !== null; depth++) {
    out.push(cursor as ErrorLevel)
    cursor = (cursor as ErrorLevel).cause
  }
  return out
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The text of one level: viem keeps the provider's message in `details`. */
function levelText(level: ErrorLevel): string {
  const details = str(level.details)
  return details !== '' ? `${str(level.shortMessage)} ${details}` : str(level.message)
}

const MULTIPLIERS: Readonly<Record<string, bigint>> = { k: 1_000n, m: 1_000_000n }

/** The span a provider's message states as its maximum, or undefined. */
export function statedMaxLogRange(text: string): bigint | undefined {
  for (const re of STATED_MAX_RES) {
    const match = text.match(re)
    const digits = match?.[1]?.replace(/[,_]/g, '')
    if (digits === undefined || !/^\d+$/.test(digits)) continue
    return BigInt(digits) * (MULTIPLIERS[match?.[2]?.toLowerCase() ?? ''] ?? 1n)
  }
  return undefined
}

function retryAfterMs(level: ErrorLevel): number | undefined {
  const headers = level.headers as { get?: (name: string) => string | null } | undefined
  const value = typeof headers?.get === 'function' ? headers.get('Retry-After')?.trim() : undefined
  if (value === undefined || value === '') return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi

/**
 * `text` with every http(s) / ws(s) URL cut to its origin: RPC URLs carry API keys in their path,
 * query or user info (`https://base-mainnet.g.alchemy.com/v2/<key>`), and viem puts the URL in its
 * error messages.
 */
export function redactUrls(text: string): string {
  return text.replace(URL_RE, (url) => {
    try {
      return new URL(url).origin
    } catch {
      return '<url>'
    }
  })
}

/** The provider's message: the first `details` in the chain, else the innermost message. */
function providerMessage(chain: readonly ErrorLevel[]): string {
  const withDetails = chain.find((level) => str(level.details) !== '')
  const text =
    withDetails !== undefined
      ? str(withDetails.details)
      : str(chain.findLast((level) => str(level.message) !== '')?.message)
  const line = redactUrls(text).replace(/\s+/g, ' ').trim()
  return line.length > 300 ? `${line.slice(0, 297)}...` : line
}

export function classifyLogsError(err: unknown): LogsErrorInfo {
  const chain = levels(err)
  const text = chain.map(levelText).join(' ')
  const codes = chain.map((level) => level.code).filter((c): c is number => typeof c === 'number')
  const statuses = chain
    .filter((level) => level.name === 'HttpRequestError')
    .map((level) => (typeof level.status === 'number' ? level.status : undefined))
  const info = (kind: LogsErrorKind, statedMax?: bigint): LogsErrorInfo => ({
    kind,
    statedMax,
    retryAfterMs: chain.map(retryAfterMs).find((ms) => ms !== undefined),
    providerMessage: providerMessage(chain),
  })

  if (chain.some((level) => level.name === RETRY_EXHAUSTED)) return info('other')
  if (chain.some((level) => level.name === 'TimeoutError')) return info('transient')
  const statedMax = statedMaxLogRange(text)
  if (statedMax !== undefined) return info('range', statedMax)
  if (
    statuses.includes(429) ||
    codes.some((code) => RATE_LIMIT_CODES.has(code)) ||
    RATE_LIMIT_RE.test(text)
  )
    return info('rate-limit')
  // A gateway's answer or no answer at all: before the range check, whose "timed out" would
  // otherwise read a gateway timeout as a rejected range (see the header).
  if (statuses.some((status) => status === undefined || TRANSIENT_HTTP_STATUS.has(status)))
    return info('transient')
  if (codes.includes(-32005) || RANGE_ERROR_RE.test(text)) return info('range')
  if (codes.includes(-32603)) return info('transient')
  return info('other')
}

/**
 * A rate-limited or transient request that was retried with backoff `retries` times and still
 * failed; `cause` is the last failure. Final: `classifyLogsError` reads it as `other`, so it is
 * never retried again or taken for a rejected range (which would split the range and retry every
 * half), and a caller sees an ordinary failure, not a LogRangeLimitError.
 */
export class RetryExhaustedError extends Error {
  override readonly name = RETRY_EXHAUSTED
  constructor(
    /** The request, e.g. `eth_getLogs blocks 1-2000` or `eth_getCode 0x… @ 12345678`. */
    readonly what: string,
    readonly kind: 'rate-limit' | 'transient',
    readonly retries: number,
    readonly providerMessage: string,
    options: { cause: unknown },
  ) {
    super(
      `${what}: still ${kind === 'rate-limit' ? 'rate limited' : 'failing'} after ${retries} ` +
        `retries with backoff (provider: "${providerMessage}")`,
      options,
    )
  }
}

export function isRetryExhaustedError(err: unknown): err is RetryExhaustedError {
  return err instanceof RetryExhaustedError
}

/** Heuristic over the error and its causes: codes/messages providers use for oversized ranges. */
export function isRangeTooLargeError(err: unknown): boolean {
  return classifyLogsError(err).kind === 'range'
}

export interface LogRangeLimitDetails {
  /**
   * `stated`: the provider named a maximum span below `minRange`; `floor`: it rejected a range
   * that halving cannot shrink without going below `minRange`.
   */
  reason: 'stated' | 'floor'
  /** The provider's stated maximum span (reason `stated`). */
  maxRange: bigint | undefined
  /** The configured `logChunkSize`. */
  chunkSize: bigint
  /** The smallest span the reader splits to: min(`minLogRange`, `logChunkSize`). */
  minRange: bigint
  fromBlock: bigint
  toBlock: bigint
  providerMessage: string
}

/**
 * The logs endpoint cannot serve `eth_getLogs` at the configured chunk size: splitting a
 * 2 000-block chunk into 10-block requests would multiply a scan's requests by 200, so the reader
 * stops instead of crawling. A chunk size the endpoint accepts (`logChunkSize` 10 on Alchemy's
 * free tier) never gets here. `summary` says what happened; `message` adds the two fixes in
 * library terms (the CLI words them with its own variables, see apps/cli/src/rpc.ts).
 */
export class LogRangeLimitError extends Error {
  override readonly name = 'LogRangeLimitError'
  readonly summary: string
  constructor(readonly details: LogRangeLimitDetails) {
    const { maxRange, chunkSize, minRange, fromBlock, toBlock } = details
    const said = details.providerMessage === '' ? '' : ` (provider: "${details.providerMessage}")`
    const summary =
      details.reason === 'stated'
        ? `eth_getLogs: the logs endpoint accepts at most ${maxRange} blocks per request${said}, ` +
          `fewer than the ${chunkSize}-block chunks configured, and the reader does not split ` +
          `ranges below ${minRange} blocks.`
        : `eth_getLogs: the logs endpoint rejected blocks ${fromBlock}-${toBlock} ` +
          `(${toBlock - fromBlock + 1n} blocks)${said}, and halving again would go below ` +
          `${minRange} blocks.`
    super(
      `${summary} Use a logs endpoint that accepts larger ranges (createChainReader ` +
        `logsRpcUrl / logsTransport), or set logChunkSize to ${logRangeLimitText(details)} for small scans.`,
    )
    this.summary = summary
  }
}

/** "10" when the provider stated its limit, else a description of it. */
export function logRangeLimitText(details: LogRangeLimitDetails): string {
  return details.maxRange === undefined ? 'a span the provider accepts' : `${details.maxRange}`
}

export function isLogRangeLimitError(err: unknown): err is LogRangeLimitError {
  return err instanceof LogRangeLimitError
}
