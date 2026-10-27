/**
 * Market-maker scorecards (roadmap layer 2): a project registers a mandate (pool, the market
 * maker's addresses, KPIs); every snapshot of that pool yields one sample evaluating the KPIs
 * against the liquidity attributable to those addresses only. See docs/design/scorecards.md.
 */

import type { Address, Hex } from '../types.js'

export interface MandateKpis {
  /** USD depth the market maker must provide on EACH side (price up and price down) at ±bandPct. */
  minDepthUsd: number
  /** Half-width of the band in percent. Default 2. */
  bandPct: number
  /** Maximum effective spread in bps measured on the market maker's liquidity alone; null = not required. */
  maxSpreadBps: number | null
  /** Round-trip notional (USD) at which the spread KPI is measured. Default 10 000. */
  spreadNotionalUsd: number
  /** Agreed uptime share (0..1), informational. Default 0.95. */
  targetUptime: number
}

export interface Mandate {
  /** Slug, /^[a-z0-9][a-z0-9-]{2,39}$/. */
  id: string
  name: string
  poolId: string
  marketMaker: string
  /** Lowercase. Position owners (v3 / v4 / Slipstream), LP-token holders or gauge depositors (Aerodrome v2), gauge depositors (Slipstream). */
  addresses: Address[]
  kpis: MandateKpis
  alertWebhookUrl: string | null
  /** Consecutive breached samples before a breach alert is sent. Default 3. */
  alertAfterSamples: number
  active: boolean
  /** Unix seconds. */
  createdAt: number
  notes: string | null
}

/**
 * A mandate as every public surface shows it (HTTP API, static export, dashboard): the stored
 * `Mandate` without `alertWebhookUrl`. A Slack or Discord style webhook URL is a bearer secret
 * (whoever holds it can post through it), so it never leaves the database and the operator's own
 * CLI; the public view says only whether one is set.
 */
export interface PublicMandate {
  id: string
  name: string
  poolId: string
  marketMaker: string
  addresses: Address[]
  kpis: MandateKpis
  /** True when an alert webhook is stored; the URL itself is never exposed. */
  alertWebhookConfigured: boolean
  alertAfterSamples: number
  active: boolean
  createdAt: number
  notes: string | null
}

export type AttributionMethod = 'positions' | 'lp-share' | 'none'

export interface MmAttribution {
  method: AttributionMethod
  /** Positions or LP holdings counted for the market maker. */
  holdings: number
  /** Share of the pool's in-band liquidity weight held by the market maker, 0..1; null when unknown. */
  shareOfPool: number | null
  /** Market-maker-only depth at ±bandPct, USD per side; null when the side is unpriced. */
  depthUpUsd: number | null
  depthDownUsd: number | null
  /** Whole-pool depth at the same band, for context. */
  poolDepthUpUsd: number | null
  poolDepthDownUsd: number | null
  /** Effective spread (bps) on the market maker's liquidity alone at kpis.spreadNotionalUsd; null when infeasible or unpriced. */
  spreadBps: number | null
  /** Whole-pool effective spread at the same notional, for context. */
  poolSpreadBps: number | null
}

export type BreachKind = 'depthUp' | 'depthDown' | 'spread' | 'noLiquidity'

export interface MmSample {
  mandateId: string
  poolId: string
  blockNumber: bigint
  timestamp: number
  attribution: MmAttribution
  /** true = every KPI met; false = at least one breach; null = not evaluable (a required USD price was missing). */
  withinKpi: boolean | null
  breaches: BreachKind[]
}

export interface UptimeWindow {
  windowHours: number
  /** Evaluable samples (withinKpi !== null) inside the window. */
  samples: number
  withinKpi: number
  /** withinKpi / samples; null when samples = 0. */
  uptime: number | null
}

export interface Excursion {
  kind: BreachKind
  timestamp: number
  blockNumber: bigint
  /** The measured value (USD or bps); null when it was unmeasurable. */
  value: number | null
  threshold: number
}

export interface BreachStreak {
  breached: boolean
  /** Consecutive samples in the current state (breached or within KPI). */
  samples: number
  /** Timestamp of the first sample of the current streak; null without samples. */
  since: number | null
}

export type ScorecardStatus = 'ok' | 'breached' | 'no-data' | 'inactive'

export interface ScorecardSummary {
  mandate: Mandate
  latest: MmSample | null
  uptime: { h24: UptimeWindow; d7: UptimeWindow; d30: UptimeWindow }
  worst: {
    minDepthUpUsd: Excursion | null
    minDepthDownUsd: Excursion | null
    maxSpreadBps: Excursion | null
  }
  streak: BreachStreak
  status: ScorecardStatus
}

/** `ScorecardSummary` with the public view of its mandate: what the API and the export serve. */
export type PublicScorecardSummary = Omit<ScorecardSummary, 'mandate'> & {
  mandate: PublicMandate
}

export type MmAlertKind = 'breach' | 'recovered'

export interface MmAlert {
  mandateId: string
  timestamp: number
  kind: MmAlertKind
  streakSamples: number
  /** JSON body that was (or would have been) posted. */
  payload: Record<string, unknown>
  delivered: boolean
  responseStatus: number | null
  error: string | null
}

/** LP-token holding of one address in an Aerodrome v2 pool (wallet balance + gauge-staked). */
export interface LpHolding {
  address: Address
  balance: bigint
  staked: bigint
  totalSupply: bigint
}

export const MANDATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/
export const DEFAULT_MANDATE_KPIS: Readonly<Omit<MandateKpis, 'minDepthUsd'>> = Object.freeze({
  bandPct: 2,
  maxSpreadBps: null,
  spreadNotionalUsd: 10_000,
  targetUptime: 0.95,
})
export const DEFAULT_ALERT_AFTER_SAMPLES = 3
export const UPTIME_WINDOWS_HOURS = Object.freeze({ h24: 24, d7: 168, d30: 720 })

/** Helper for ids of pools referenced from mandates (re-exported for convenience). */
export type PoolRef = { poolId: string; poolAddress: Address | null; poolIdHex: Hex | null }
