/**
 * Webhook alerts (docs/design/scorecards.md §5): after the samples of a pass are stored, for each
 * mandate with a webhook URL, the current streak over its last `alertAfterSamples + 1` samples
 * decides whether to post a `breach` (the streak is breached, at least `alertAfterSamples` long
 * and not already alerted) or a `recovered` event (the latest recorded alert is a `breach` and
 * the mandate is now within KPI). Every attempt is recorded in `mm_alerts`, delivered or not; a
 * failed attempt is not retried, and nothing here ever throws into the pipeline.
 *
 * The POST uses the global `fetch` (injectable for tests) with a 5 s timeout.
 */
import {
  type BreachStreak,
  currentStreak,
  jsonStringify,
  type Mandate,
  type MmAlert,
  type MmAlertKind,
  type MmSample,
} from '@depthwatch/core'
import { scorecardUrl } from '../config.js'
import { errorMessage } from '../log.js'
import type { PipelineContext } from './context.js'

export const ALERT_TIMEOUT_MS = 5_000
export const ALERT_USER_AGENT = 'depthwatch-alerts'

/** The subset of `fetch` the delivery needs, so tests can inject a stub. */
export type WebhookFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>

export interface AlertOptions {
  /** Defaults to the global `fetch`. */
  fetch?: WebhookFetch
  /** Defaults to ALERT_TIMEOUT_MS. */
  timeoutMs?: number
}

export interface AlertDecision {
  kind: MmAlertKind
  /** The newest sample (the one the event reports). */
  latest: MmSample
  streak: BreachStreak
}

/**
 * Whether `lastAlert` (a `breach`) was sent for the breached streak at hand, walked over `window`
 * (the mandate's newest samples, ascending, at most `alertAfterSamples + 1`). A breach alert is
 * for the current streak when it was recorded at or after the streak's first sample. When the
 * window is full (`window.length > alertAfterSamples`) and holds no within-KPI sample, the streak
 * reaches back to the window's oldest sample and its true start lies at or before it; the alert is
 * then taken as this streak's: a streak only ends with a within-KPI sample, which always records a
 * `recovered` alert, so a `breach` as the latest alert belongs to the streak in progress.
 * Unevaluable samples take window slots without extending or ending a streak, so the streak's
 * length alone (`streak.samples > alertAfterSamples`) cannot tell that it fills the window.
 */
export function alertedForStreak(
  lastAlert: MmAlert | undefined,
  streak: BreachStreak,
  window: readonly MmSample[],
  alertAfterSamples: number,
): boolean {
  if (lastAlert === undefined || lastAlert.kind !== 'breach') return false
  if (window.length > alertAfterSamples && window.every((s) => s.withinKpi !== true)) return true
  return streak.since !== null && lastAlert.timestamp >= streak.since
}

/**
 * The event to send, if any, given the mandate's newest samples (ascending, the last
 * `alertAfterSamples + 1`) and its latest recorded alert.
 */
export function decideAlert(
  mandate: Mandate,
  samples: readonly MmSample[],
  lastAlert: MmAlert | undefined,
): AlertDecision | null {
  const latest = samples[samples.length - 1]
  if (latest === undefined) return null
  const streak = currentStreak(samples)
  if (
    streak.breached &&
    streak.samples >= mandate.alertAfterSamples &&
    !alertedForStreak(lastAlert, streak, samples, mandate.alertAfterSamples)
  )
    return { kind: 'breach', latest, streak }
  if (latest.withinKpi === true && lastAlert?.kind === 'breach')
    return { kind: 'recovered', latest, streak }
  return null
}

/** The JSON body of an alert (bigints as decimal strings once serialised). */
export function buildAlertPayload(
  mandate: Mandate,
  decision: AlertDecision,
  url: string,
): Record<string, unknown> {
  const { latest, streak } = decision
  return {
    event: decision.kind,
    mandateId: mandate.id,
    name: mandate.name,
    poolId: mandate.poolId,
    timestamp: latest.timestamp,
    blockNumber: latest.blockNumber.toString(),
    streakSamples: streak.samples,
    breaches: latest.breaches,
    attribution: latest.attribution,
    scorecardUrl: url,
  }
}

export interface DeliveryOutcome {
  delivered: boolean
  responseStatus: number | null
  error: string | null
}

/** POSTs the payload; a non-2xx answer or a thrown request (timeout included) is an outcome, never an exception. */
export async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>,
  opts: AlertOptions = {},
): Promise<DeliveryOutcome> {
  const post = opts.fetch ?? (fetch as unknown as WebhookFetch)
  const timeoutMs = opts.timeoutMs ?? ALERT_TIMEOUT_MS
  try {
    const response = await post(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ALERT_USER_AGENT },
      body: jsonStringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return {
      delivered: response.ok,
      responseStatus: response.status,
      error: response.ok ? null : `webhook answered HTTP ${response.status}`,
    }
  } catch (error) {
    return { delivered: false, responseStatus: null, error: errorMessage(error) }
  }
}

export interface AlertsResult {
  /** Mandates with a webhook that were checked. */
  mandates: number
  /** Alerts attempted (and recorded). */
  attempts: number
  delivered: number
  alerts: MmAlert[]
}

/**
 * Checks every given mandate that has a webhook and sends what `decideAlert` asks for. Each
 * attempt is recorded in `mm_alerts` (timestamped with the sample that triggered it). Errors of
 * any kind are logged; the function never throws.
 */
export async function deliverAlerts(
  ctx: PipelineContext,
  mandates: readonly Mandate[],
  opts: AlertOptions = {},
): Promise<AlertsResult> {
  const { db, log, config } = ctx
  const result: AlertsResult = { mandates: 0, attempts: 0, delivered: 0, alerts: [] }
  for (const mandate of mandates) {
    if (mandate.alertWebhookUrl === null) continue
    result.mandates++
    try {
      const samples = db.mmSamples.recentFor(mandate.id, mandate.alertAfterSamples + 1)
      const decision = decideAlert(mandate, samples, db.mmAlerts.latestFor(mandate.id))
      if (decision === null) continue
      const payload = buildAlertPayload(mandate, decision, scorecardUrl(config, mandate.id))
      const outcome = await deliverWebhook(mandate.alertWebhookUrl, payload, opts)
      const alert: MmAlert = {
        mandateId: mandate.id,
        timestamp: decision.latest.timestamp,
        kind: decision.kind,
        streakSamples: decision.streak.samples,
        payload,
        ...outcome,
      }
      db.mmAlerts.insert(alert)
      result.attempts++
      result.alerts.push(alert)
      if (outcome.delivered) {
        result.delivered++
        log.info('alert delivered', {
          mandate: mandate.id,
          event: decision.kind,
          streak: decision.streak.samples,
          status: outcome.responseStatus,
        })
      } else {
        log.warn('alert not delivered', {
          mandate: mandate.id,
          event: decision.kind,
          status: outcome.responseStatus,
          error: outcome.error,
        })
      }
    } catch (error) {
      log.error('alert check failed', { mandate: mandate.id, error: errorMessage(error) })
    }
  }
  return result
}
