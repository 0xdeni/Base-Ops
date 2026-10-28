/**
 * Mandate registration parsing (docs/design/scorecards.md §1): turns the registration JSON (the
 * `Mandate` shape minus the optional `active` / `createdAt`) into a `Mandate`, applying the
 * defaults and reporting every problem at once through `MandateValidationError`, and merges a
 * re-registration with the stored mandate (`mergeRegistration`).
 */

import { type Address, DEXES, type Dex } from '../types.js'
import {
  DEFAULT_ALERT_AFTER_SAMPLES,
  DEFAULT_MANDATE_KPIS,
  MANDATE_ID_PATTERN,
  type Mandate,
  type MandateKpis,
  type PublicMandate,
} from './types.js'
import { WEBHOOK_URL_PROBLEM, webhookUrlProblem } from './webhookUrl.js'

/** The registration JSON: `Mandate` with every defaulted field optional. */
export interface MandateRegistration {
  id: string
  /** At most `MANDATE_LIMITS.name` characters. */
  name: string
  /**
   * `<dex>:0x<40 hex>` (the pool address) or `uniswap-v4:0x<64 hex>` (the v4 pool id); any case is
   * accepted, stored lowercase like every pool id.
   */
  poolId: string
  /** At most `MANDATE_LIMITS.marketMaker` characters. */
  marketMaker: string
  /** Any case is accepted; stored lowercase. At most `MANDATE_LIMITS.addresses` entries. */
  addresses: string[]
  kpis: { minDepthUsd: number } & Partial<Omit<MandateKpis, 'minDepthUsd'>>
  alertWebhookUrl?: string | null
  alertAfterSamples?: number
  active?: boolean
  createdAt?: number
  /** At most `MANDATE_LIMITS.notes` characters. */
  notes?: string | null
}

/**
 * Upper bounds of a registration (docs/SCORECARDS.md "Mandate"): every pass reads the holdings
 * of every address, and the strings are stored and served as they are.
 */
export const MANDATE_LIMITS = Object.freeze({
  addresses: 50,
  name: 120,
  marketMaker: 120,
  notes: 2_000,
})

export class MandateValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`invalid mandate: ${problems.join('; ')}`)
    this.name = 'MandateValidationError'
    this.problems = [...problems]
  }
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/** Hex digits after `0x` in a pool id: a pool address, or the bytes32 id of a Uniswap v4 pool. */
const POOL_KEY_HEX_DIGITS: Readonly<Record<Dex, number>> = Object.freeze({
  'uniswap-v3': 40,
  'uniswap-v4': 64,
  'aerodrome-v2': 40,
  'aerodrome-slipstream': 40,
  'aero-v2': 40,
  'aero-slipstream': 40,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A trimmed non-empty string of at most `max` characters, or null (with a problem recorded). */
function requiredString(
  value: unknown,
  field: string,
  max: number,
  problems: string[],
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length === 0) problems.push(`${field} must be a non-empty string`)
  else if (trimmed.length > max) problems.push(`${field} must be at most ${max} characters`)
  else return trimmed
  return null
}

function isDex(value: string): value is Dex {
  return (DEXES as readonly string[]).includes(value)
}

/**
 * A pool id as the observatory stores it: `<dex>:0x<40 hex>`, or `uniswap-v4:0x<64 hex>`, in
 * lowercase whatever case it was given in, so it matches `pools.id` and the mandate is sampled.
 */
function parsePoolId(value: unknown, problems: string[]): string | null {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const colon = id.indexOf(':')
  const dex = id.slice(0, colon)
  const key = id.slice(colon + 1)
  if (colon > 0 && isDex(dex) && new RegExp(`^0x[0-9a-f]{${POOL_KEY_HEX_DIGITS[dex]}}$`).test(key))
    return id
  problems.push(
    `poolId must be <dex>:<0x pool address>, or uniswap-v4:<0x pool id of 64 hex digits>, with <dex> one of ${DEXES.join(', ')}`,
  )
  return null
}

function parseAddresses(value: unknown, problems: string[]): Address[] {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push('addresses must be a non-empty array of 0x addresses')
    return []
  }
  if (value.length > MANDATE_LIMITS.addresses) {
    problems.push(`addresses must list at most ${MANDATE_LIMITS.addresses} addresses`)
    return []
  }
  const out: Address[] = []
  value.forEach((entry, i) => {
    if (typeof entry !== 'string' || !ADDRESS_PATTERN.test(entry)) {
      problems.push(`addresses[${i}] must be a 0x-prefixed 20-byte hex address`)
      return
    }
    const address = entry.toLowerCase() as Address
    if (!out.includes(address)) out.push(address)
  })
  return out
}

function parseKpis(value: unknown, problems: string[]): MandateKpis {
  const kpis: MandateKpis = { minDepthUsd: 0, ...DEFAULT_MANDATE_KPIS }
  if (!isRecord(value)) {
    problems.push('kpis must be an object with minDepthUsd')
    return kpis
  }
  if (isFiniteNumber(value.minDepthUsd) && value.minDepthUsd > 0)
    kpis.minDepthUsd = value.minDepthUsd
  else problems.push('kpis.minDepthUsd must be a number > 0')
  if (value.bandPct !== undefined) {
    if (isFiniteNumber(value.bandPct) && value.bandPct > 0 && value.bandPct < 100)
      kpis.bandPct = value.bandPct
    else problems.push('kpis.bandPct must be a number between 0 and 100 (exclusive)')
  }
  if (value.maxSpreadBps !== undefined && value.maxSpreadBps !== null) {
    if (isFiniteNumber(value.maxSpreadBps) && value.maxSpreadBps > 0)
      kpis.maxSpreadBps = value.maxSpreadBps
    else problems.push('kpis.maxSpreadBps must be null or a number > 0')
  }
  if (value.spreadNotionalUsd !== undefined) {
    if (isFiniteNumber(value.spreadNotionalUsd) && value.spreadNotionalUsd > 0)
      kpis.spreadNotionalUsd = value.spreadNotionalUsd
    else problems.push('kpis.spreadNotionalUsd must be a number > 0')
  }
  if (value.targetUptime !== undefined) {
    if (isFiniteNumber(value.targetUptime) && value.targetUptime > 0 && value.targetUptime <= 1)
      kpis.targetUptime = value.targetUptime
    else problems.push('kpis.targetUptime must be a number in (0, 1]')
  }
  return kpis
}

/** An http(s) URL at a public host without user info (`webhookUrlProblem`), or null. */
function parseWebhookUrl(value: unknown, problems: string[]): string | null {
  if (value === undefined || value === null) return null
  const problem = typeof value === 'string' ? webhookUrlProblem(value) : WEBHOOK_URL_PROBLEM
  if (problem === null) return value as string
  problems.push(problem)
  return null
}

function parseAlertAfterSamples(value: unknown, problems: string[]): number {
  if (value === undefined) return DEFAULT_ALERT_AFTER_SAMPLES
  if (Number.isInteger(value) && (value as number) >= 1) return value as number
  problems.push('alertAfterSamples must be an integer ≥ 1')
  return DEFAULT_ALERT_AFTER_SAMPLES
}

function parseNotes(value: unknown, problems: string[]): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    problems.push('notes must be null or a string')
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length <= MANDATE_LIMITS.notes) return trimmed.length > 0 ? trimmed : null
  problems.push(`notes must be at most ${MANDATE_LIMITS.notes} characters`)
  return null
}

/**
 * Validates a registration (JSON-parsed, unknown shape) into a `Mandate`, applying the defaults
 * (`DEFAULT_MANDATE_KPIS`, `alertAfterSamples` 3, `active` true, `createdAt` = `now`, nulls).
 * The pool id and the addresses are lowercased, the addresses de-duplicated, and the sizes held
 * to `MANDATE_LIMITS`. Throws `MandateValidationError` listing every problem found. Unknown
 * properties are ignored.
 */
export function parseMandate(input: unknown, now: number): Mandate {
  if (!isRecord(input)) throw new MandateValidationError(['mandate must be a JSON object'])
  const problems: string[] = []
  const id = typeof input.id === 'string' && MANDATE_ID_PATTERN.test(input.id) ? input.id : null
  if (id === null) problems.push(`id must match ${MANDATE_ID_PATTERN}`)
  const name = requiredString(input.name, 'name', MANDATE_LIMITS.name, problems)
  const poolId = parsePoolId(input.poolId, problems)
  const marketMaker = requiredString(
    input.marketMaker,
    'marketMaker',
    MANDATE_LIMITS.marketMaker,
    problems,
  )
  const addresses = parseAddresses(input.addresses, problems)
  const kpis = parseKpis(input.kpis, problems)
  const alertWebhookUrl = parseWebhookUrl(input.alertWebhookUrl, problems)
  const alertAfterSamples = parseAlertAfterSamples(input.alertAfterSamples, problems)
  let active = true
  if (input.active !== undefined) {
    if (typeof input.active === 'boolean') active = input.active
    else problems.push('active must be a boolean')
  }
  let createdAt = now
  if (input.createdAt !== undefined) {
    if (isFiniteNumber(input.createdAt) && input.createdAt >= 0)
      createdAt = Math.floor(input.createdAt)
    else problems.push('createdAt must be a unix timestamp in seconds')
  }
  const notes = parseNotes(input.notes, problems)
  if (
    problems.length > 0 ||
    id === null ||
    name === null ||
    poolId === null ||
    marketMaker === null
  )
    throw new MandateValidationError(problems)
  return {
    id,
    name,
    poolId,
    marketMaker,
    addresses,
    kpis,
    alertWebhookUrl,
    alertAfterSamples,
    active,
    createdAt,
    notes,
  }
}

/**
 * What a registration stores when its id may exist already: re-registering corrects the mandate
 * in place, so `existing`'s `active` flag and `createdAt` survive unless `input` (the registration
 * `parsed` came from) sets them. A deactivated mandate therefore stays deactivated when its file is
 * registered again; `"active": true` resumes it. Without `existing`, `parsed` as it is.
 */
export function mergeRegistration(
  parsed: Mandate,
  existing: Mandate | undefined,
  input: unknown,
): Mandate {
  if (existing === undefined || !isRecord(input)) return parsed
  return {
    ...parsed,
    active: input.active === undefined ? existing.active : parsed.active,
    createdAt: input.createdAt === undefined ? existing.createdAt : parsed.createdAt,
  }
}

/**
 * The public view of a mandate (`PublicMandate`): every field is copied by name, so a field added
 * to `Mandate` later stays private until this function is told otherwise. `alertWebhookUrl`
 * becomes the boolean `alertWebhookConfigured`.
 */
export function toPublicMandate(mandate: Mandate): PublicMandate {
  return {
    id: mandate.id,
    name: mandate.name,
    poolId: mandate.poolId,
    marketMaker: mandate.marketMaker,
    addresses: [...mandate.addresses],
    kpis: { ...mandate.kpis },
    alertWebhookConfigured: mandate.alertWebhookUrl !== null,
    alertAfterSamples: mandate.alertAfterSamples,
    active: mandate.active,
    createdAt: mandate.createdAt,
    notes: mandate.notes,
  }
}

/**
 * A webhook URL made safe to print: scheme and host (and port) only, `https://hooks.example.com/…`.
 * The path, query and any user info are where the secret lives. Text that is not a URL gives `…`.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url)
    return `${protocol}//${host}/…`
  } catch {
    return '…'
  }
}
