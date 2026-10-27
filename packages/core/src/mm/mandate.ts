/**
 * Mandate registration parsing (docs/design/scorecards.md §1): turns the registration JSON (the
 * `Mandate` shape minus the optional `active` / `createdAt`) into a `Mandate`, applying the
 * defaults and reporting every problem at once through `MandateValidationError`.
 */

import type { Address } from '../types.js'
import {
  DEFAULT_ALERT_AFTER_SAMPLES,
  DEFAULT_MANDATE_KPIS,
  MANDATE_ID_PATTERN,
  type Mandate,
  type MandateKpis,
  type PublicMandate,
} from './types.js'

/** The registration JSON: `Mandate` with every defaulted field optional. */
export interface MandateRegistration {
  id: string
  name: string
  poolId: string
  marketMaker: string
  /** Any case is accepted; stored lowercase. */
  addresses: string[]
  kpis: { minDepthUsd: number } & Partial<Omit<MandateKpis, 'minDepthUsd'>>
  alertWebhookUrl?: string | null
  alertAfterSamples?: number
  active?: boolean
  createdAt?: number
  notes?: string | null
}

export class MandateValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`invalid mandate: ${problems.join('; ')}`)
    this.name = 'MandateValidationError'
    this.problems = [...problems]
  }
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A trimmed non-empty string, or null (with a problem recorded). */
function requiredString(value: unknown, field: string, problems: string[]): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length > 0) return trimmed
  problems.push(`${field} must be a non-empty string`)
  return null
}

function parseAddresses(value: unknown, problems: string[]): Address[] {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push('addresses must be a non-empty array of 0x addresses')
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

function parseWebhookUrl(value: unknown, problems: string[]): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:') return value
    } catch {
      // reported below
    }
  }
  problems.push('alertWebhookUrl must be null or an http(s) URL')
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
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null
  problems.push('notes must be null or a string')
  return null
}

/**
 * Validates a registration (JSON-parsed, unknown shape) into a `Mandate`, applying the defaults
 * (`DEFAULT_MANDATE_KPIS`, `alertAfterSamples` 3, `active` true, `createdAt` = `now`, nulls).
 * Addresses are lowercased and de-duplicated. Throws `MandateValidationError` listing every
 * problem found. Unknown properties are ignored.
 */
export function parseMandate(input: unknown, now: number): Mandate {
  if (!isRecord(input)) throw new MandateValidationError(['mandate must be a JSON object'])
  const problems: string[] = []
  const id = typeof input.id === 'string' && MANDATE_ID_PATTERN.test(input.id) ? input.id : null
  if (id === null) problems.push(`id must match ${MANDATE_ID_PATTERN}`)
  const name = requiredString(input.name, 'name', problems)
  const poolId = requiredString(input.poolId, 'poolId', problems)
  const marketMaker = requiredString(input.marketMaker, 'marketMaker', problems)
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
