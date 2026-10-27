/**
 * One short line for an error and its causes, for logs and stderr.
 *
 * viem's `message` repeats the whole JSON-RPC request body ("Request body: {…}", a multicall's
 * calldata runs to tens of kilobytes), the call's arguments and the contract call, and a pipeline
 * warning that logged it drowned the log in hex. Here a viem error contributes one line built from
 * its short message, the HTTP status, the endpoint (cut to its origin: RPC URLs carry API keys),
 * the JSON-RPC method(s) of the request and the provider's own `details`, never the body; any other
 * error contributes its message.
 */
import { redactUrls } from './logErrors.js'

interface Level {
  name?: unknown
  message?: unknown
  shortMessage?: unknown
  details?: unknown
  status?: unknown
  code?: unknown
  url?: unknown
  body?: unknown
  metaMessages?: unknown
  cause?: unknown
}

/** Levels of the cause chain read, like the CLI's former `errorMessage`: the error and 4 causes. */
const MAX_LEVELS = 5
/** Characters kept of a provider's `details`. */
const MAX_DETAILS = 300

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function isViem(level: Level): boolean {
  return str(level.shortMessage) !== ''
}

function methodOf(entry: unknown): string {
  const method = (entry as { method?: unknown } | null)?.method
  return typeof method === 'string' ? method : '?'
}

/** `eth_call`, or `batch of 3: eth_call ×2, eth_getBlockByNumber` for a batched request. */
export function requestMethods(body: unknown): string | undefined {
  if (Array.isArray(body)) {
    const counts = new Map<string, number>()
    for (const entry of body) counts.set(methodOf(entry), (counts.get(methodOf(entry)) ?? 0) + 1)
    const list = [...counts].map(([method, n]) => (n > 1 ? `${method} ×${n}` : method))
    return `batch of ${body.length}: ${list.join(', ')}`
  }
  if (typeof body === 'object' && body !== null) return methodOf(body)
  return undefined
}

const BODY_META = 'Request body: '
const METHOD_RE = /"method":"([^"\\]+)"/g

/**
 * The request body of a level: `body` (HttpRequestError), else the methods named in its
 * "Request body: …" meta line (RpcRequestError and TimeoutError keep the body only there).
 */
function bodyOf(level: Level): unknown {
  if (level.body !== undefined) return level.body
  const metas = Array.isArray(level.metaMessages) ? level.metaMessages : []
  const meta = metas.find((m): m is string => typeof m === 'string' && m.startsWith(BODY_META))
  if (meta === undefined) return undefined
  const json = meta.slice(BODY_META.length).trimStart()
  const entries = [...json.matchAll(METHOD_RE)].map((match) => ({ method: match[1] }))
  if (entries.length === 0) return undefined
  return json.startsWith('[') ? entries : entries[0]
}

function oneLine(text: string, max = Number.POSITIVE_INFINITY): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

/** The single line standing for a run of viem levels (outermost first). */
function viemLine(levels: readonly Level[]): string {
  const innermost = levels[levels.length - 1] ?? {}
  const request = levels.find((level) => level.body !== undefined || level.url !== undefined)
  const status = levels.map((level) => level.status).find((s) => typeof s === 'number')
  const code = typeof request?.code === 'number' ? request.code : undefined
  const details = [...levels].reverse().find((level) => str(level.details) !== '')?.details
  const parts = [str(innermost.shortMessage)]
  if (status !== undefined) parts.push(`Status: ${status}`)
  if (code !== undefined) parts.push(`Code: ${code}`)
  if (str(request?.url) !== '') parts.push(`URL: ${str(request?.url)}`)
  const methods = request === undefined ? undefined : requestMethods(bodyOf(request))
  if (methods !== undefined) parts.push(`Method: ${methods}`)
  if (str(details) !== '') parts.push(`Details: ${oneLine(str(details), MAX_DETAILS)}`)
  return oneLine(parts.join(' '))
}

/**
 * `error` as one line: messages of the error and its causes joined by ': ' (repeats dropped),
 * each run of viem errors replaced by one summary line without the request body, every URL cut to
 * its origin.
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return redactUrls(oneLine(String(error)))
  const parts: string[] = []
  let viemRun: Level[] = []
  const flush = () => {
    if (viemRun.length > 0) parts.push(viemLine(viemRun))
    viemRun = []
  }
  let cursor: unknown = error
  for (let depth = 0; depth < MAX_LEVELS && cursor instanceof Error; depth++) {
    const level = cursor as Level
    if (isViem(level)) viemRun.push(level)
    else {
      flush()
      const message = oneLine(str(level.message) || (depth === 0 ? str(level.name) : ''))
      if (message !== '' && !parts.includes(message)) parts.push(message)
    }
    cursor = level.cause
  }
  flush()
  return redactUrls(parts.filter((part, i) => parts.indexOf(part) === i).join(': '))
}
