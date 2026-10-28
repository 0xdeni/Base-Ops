/**
 * Webhook alerts (docs/design/scorecards.md §5): after the samples of a pass are stored, for each
 * mandate with a webhook URL, the current streak over its last `alertAfterSamples + 1` samples and
 * the mandate's alert history (`alertHistory`) decide whether to post a `breach` (the streak is
 * breached, at least `alertAfterSamples` long, no breach of it was delivered and fewer than
 * MAX_ALERT_ATTEMPTS were recorded for it) or a `recovered` event (the latest delivered alert is
 * a `breach`, the mandate is now within KPI and fewer than MAX_ALERT_ATTEMPTS recovery attempts
 * followed that breach). A breached streak starts after the mandate's newest within-KPI sample,
 * so an alert belongs to it when it was recorded after that sample. Every attempt is recorded in
 * `mm_alerts`, delivered or not; an undelivered one is tried again at the next sample that calls
 * for the same event, within the cap, and nothing here ever throws into the pipeline.
 *
 * The POST uses the global `fetch` (injectable for tests) with a 5 s timeout. Redirects are not
 * followed: the registered host is where the alert goes, a 3xx answer is a failed delivery, and
 * the response body is cancelled unread.
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
import type { Database } from '@depthwatch/db'
import { scorecardUrl } from '../config.js'
import { errorMessage } from '../log.js'
import type { PipelineContext } from './context.js'

export const ALERT_TIMEOUT_MS = 5_000
export const ALERT_USER_AGENT = 'depthwatch-alerts'
/** Attempts per event at most: a breach per streak, a recovery per delivered breach. */
export const MAX_ALERT_ATTEMPTS = 5

/** The subset of `fetch` the delivery needs, so tests can inject a stub. */
export type WebhookFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal: AbortSignal
    redirect: 'manual'
  },
) => Promise<{ ok: boolean; status: number; body?: { cancel(): Promise<void> } | null }>

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

/** What the mandate's alert log says, read before deciding (`alertHistory`). */
export interface AlertHistory {
  /** The newest delivered alert, whatever its kind. */
  lastDelivered: MmAlert | undefined
  /** Timestamp of the newest within-KPI sample: a breached streak starts after it (none: undefined). */
  withinKpiAt: number | undefined
  /** Breach attempts recorded for the current streak, delivered or not. */
  breachAttempts: number
  /** Recovery attempts recorded since the last delivered breach. */
  recoveredAttempts: number
}

export function alertHistory(db: Database, mandateId: string): AlertHistory {
  const lastDelivered = db.mmAlerts.latestDeliveredFor(mandateId)
  const withinKpiAt = db.mmSamples.lastWithinKpiAt(mandateId)
  return {
    lastDelivered,
    withinKpiAt,
    breachAttempts: db.mmAlerts.countAttempts(mandateId, 'breach', withinKpiAt),
    recoveredAttempts:
      lastDelivered?.kind === 'breach'
        ? db.mmAlerts.countAttempts(mandateId, 'recovered', lastDelivered.timestamp)
        : 0,
  }
}

/** Whether a `breach` of the current streak (the samples after `withinKpiAt`) was delivered. */
function breachDelivered({ lastDelivered, withinKpiAt }: AlertHistory): boolean {
  if (lastDelivered?.kind !== 'breach') return false
  return withinKpiAt === undefined || lastDelivered.timestamp > withinKpiAt
}

/**
 * The event to send, if any, given the mandate's newest samples (ascending, the last
 * `alertAfterSamples + 1`) and its alert history.
 */
export function decideAlert(
  mandate: Mandate,
  samples: readonly MmSample[],
  history: AlertHistory,
): AlertDecision | null {
  const latest = samples[samples.length - 1]
  if (latest === undefined) return null
  const streak = currentStreak(samples)
  if (
    streak.breached &&
    streak.samples >= mandate.alertAfterSamples &&
    !breachDelivered(history) &&
    history.breachAttempts < MAX_ALERT_ATTEMPTS
  )
    return { kind: 'breach', latest, streak }
  if (
    latest.withinKpi === true &&
    history.lastDelivered?.kind === 'breach' &&
    history.recoveredAttempts < MAX_ALERT_ATTEMPTS
  )
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

/**
 * POSTs the payload; a non-2xx answer (a redirect included: it is not followed) or a thrown request
 * (timeout included) is an outcome, never an exception.
 */
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
      redirect: 'manual',
    })
    await response.body?.cancel().catch(() => undefined)
    const { status } = response
    if (status >= 300 && status < 400)
      return {
        delivered: false,
        responseStatus: status,
        error: `webhook redirected (HTTP ${status}); redirects are not followed`,
      }
    return {
      delivered: response.ok,
      responseStatus: status,
      error: response.ok ? null : `webhook answered HTTP ${status}`,
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
      const decision = decideAlert(mandate, samples, alertHistory(db, mandate.id))
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
