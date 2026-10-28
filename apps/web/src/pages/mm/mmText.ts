/**
 * The words of the scorecard screens (ia-v3 §4.5–§4.6, docs/design/visual-v4.md §6.6–§6.7): answer
 * sentences, the eyebrow, fact labels, section takeaways and row lines. Pure: every number is read
 * as the API stored it (core's uptime, streak, worst excursions and stored KPI evaluations) and
 * only formatted here; marks come from `sampleMark`, so a sentence never contradicts the status.
 */
import type {
  MmSampleDto,
  SampleWindow,
  ScorecardSummaryDto,
  UptimeWindow,
} from '../../api/types.js'
import {
  ago,
  bps,
  count,
  dexLabel,
  fee,
  hours,
  NB,
  pairLabel,
  shortAddress,
  uptime,
  usd,
} from '../../lib/format.js'
import {
  type BreachEpisode,
  breachSides,
  episodeHours,
  type KpiMark,
  SAMPLE_WINDOW_HOURS,
  sampleMark,
  splitPoolId,
} from '../../lib/scorecard.js'

export const WINDOW_LABEL: Readonly<Record<SampleWindow, string>> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
}

export const WINDOW_SHORT: Readonly<Record<SampleWindow, string>> = {
  '24h': `24${NB}h`,
  '7d': `7${NB}d`,
  '30d': `30${NB}d`,
}

/** The uptime window of the summary that matches a sample window. */
export const UPTIME_KEY: Readonly<Record<SampleWindow, 'h24' | 'd7' | 'd30'>> = {
  '24h': 'h24',
  '7d': 'd7',
  '30d': 'd30',
}

/** `?window=`: 7 d by default (ia-v3 §2). */
export function readWindow(value: string | null): SampleWindow {
  return value === '24h' || value === '30d' ? value : '7d'
}

/** A window's x domain, ending at the samples response's `to` (the server clock). */
export function windowDomain(to: number, w: SampleWindow): [number, number] {
  return [to - SAMPLE_WINDOW_HOURS[w] * 3600, to]
}

/**
 * The samples a window's uptime counts: (from, to]. The response's `from` bound is inclusive, so a
 * sample sitting exactly on it belongs to the longer window, as core's uptime counts it.
 */
export function windowPoints<T extends { timestamp: number }>(
  points: readonly T[],
  dom: readonly [number, number],
): T[] {
  return points.filter((p) => p.timestamp > dom[0] && p.timestamp <= dom[1])
}

/**
 * The streak (ia-v3 §4.6): "Breached for 8 consecutive samples, since 14 h ago." It reads the
 * current run of the latest sample's state; the "depth over time" section leads with it.
 */
export function streakLine(
  sc: Pick<ScorecardSummaryDto, 'mandate' | 'latest' | 'streak'>,
  now: number,
): string {
  if (!sc.mandate.active) {
    return sc.latest
      ? `Inactive since its last sample, ${ago(sc.latest.timestamp, now)}.`
      : 'Inactive, with no samples.'
  }
  const { streak } = sc
  if (!sc.latest || streak.samples === 0) return 'No samples yet.'
  const state = streak.breached ? 'Breached' : 'Within KPI'
  if (streak.samples === 1)
    return `${state} at the latest sample, ${ago(sc.latest.timestamp, now)}.`
  const since = streak.since !== null ? `, since ${ago(streak.since, now)}` : ''
  return `${state} for ${count(streak.samples)} consecutive samples${since}.`
}

/**
 * The Scorecard's answer (docs/design/visual-v4.md §6.7): what the latest sample says against the
 * per-side KPI, read from the evaluation core stored with it. "The sell side is below its $400K
 * KPI: $386K sits within 2 % of the price."
 */
export function scorecardAnswer(
  sc: Pick<ScorecardSummaryDto, 'mandate' | 'latest'>,
  now: number,
): string {
  const { mandate, latest } = sc
  if (!mandate.active) {
    return latest
      ? `Inactive since its last sample, ${ago(latest.timestamp, now)}.`
      : 'Inactive, with no samples.'
  }
  if (!latest) return 'No samples yet.'
  if (latest.withinKpi === null)
    return 'The latest sample has no USD price, so it can’t be checked.'
  if (latest.breaches.includes('noLiquidity'))
    return 'The latest sample found none of the market maker’s liquidity in the pool.'
  const { kpis } = mandate
  const kpi = usd(kpis.minDepthUsd)
  const band = `${kpis.bandPct}${NB}%`
  const a = latest.attribution
  const sell = sampleMark(latest, 'depthDown') === 'fail'
  const buy = sampleMark(latest, 'depthUp') === 'fail'
  if (sell && buy)
    return `Both sides are below the ${kpi} KPI: ${usd(a.depthDownUsd)} and ${usd(a.depthUpUsd)} sit within ${band} of the price.`
  if (sell)
    return `The sell side is below its ${kpi} KPI: ${usd(a.depthDownUsd)} sits within ${band} of the price.`
  if (buy)
    return `The buy side is below its ${kpi} KPI: ${usd(a.depthUpUsd)} sits within ${band} of the price.`
  if (kpis.maxSpreadBps !== null && sampleMark(latest, 'spread') === 'fail') {
    const at = usd(kpis.spreadNotionalUsd)
    return a.spreadBps === null
      ? `Both sides hold the ${kpi} KPI, but the market maker can’t absorb ${at}.`
      : `Both sides hold the ${kpi} KPI, but the spread at ${at} is ${bps(a.spreadBps)}, above its ${bps(kpis.maxSpreadBps)} KPI.`
  }
  return `Both sides are within the ${kpi} KPI at the latest sample.`
}

/** The list's answer with no mandate (§5.12); a published snapshot speaks of itself. */
export function noMandates(snapshot: boolean): string {
  return snapshot
    ? 'No market-maker mandates are registered in this snapshot.'
    : 'No market-maker mandates are registered yet.'
}

/** The list's answer (ia-v3 §4.5): "1 of 2 mandates is within its KPIs right now." */
export function listAnswer(
  items: readonly Pick<ScorecardSummaryDto, 'mandate' | 'status'>[],
  snapshot = false,
) {
  if (!items.length) return noMandates(snapshot)
  const active = items.filter((s) => s.mandate.active)
  if (!active.length) {
    return items.length === 1
      ? 'The only mandate is inactive.'
      : `All ${count(items.length)} mandates are inactive.`
  }
  const ok = active.filter((s) => s.status === 'ok').length
  const of = active.length
  const noun = `${active.length < items.length ? 'active ' : ''}${of === 1 ? 'mandate' : 'mandates'}`
  const verb = ok === 1 || of === 1 ? 'is within its KPIs' : 'are within their KPIs'
  return `${count(ok)} of ${count(of)} ${noun} ${verb} right now.`
}

/** The comparison word of a KPI mark: within it, below it, or not evaluable against it. */
export function markWord(mark: KpiMark, failWord = 'below'): string {
  if (mark === 'pass') return 'within'
  return mark === 'fail' ? failWord : 'not evaluable against'
}

/**
 * The uptime fact (§6.7): the count leads, so a one-sample uptime never reads as a rate alone.
 * "80 of 83" over "samples within KPI in 7 d: uptime 96.4 %, target 95 %".
 */
export function uptimeFact(u: Pick<UptimeWindow, 'samples' | 'withinKpi' | 'uptime'>): string {
  return u.samples === 0 ? '—' : `${count(u.withinKpi)} of ${count(u.samples)}`
}

export function uptimeLabel(u: Pick<UptimeWindow, 'samples' | 'uptime'>, target: number): string {
  if (u.samples === 0 || u.uptime === null)
    return `samples within KPI in 7${NB}d: none evaluable yet, target ${uptime(target)}`
  return `samples within KPI in 7${NB}d: uptime ${uptime(u.uptime)}, target ${uptime(target)}`
}

/** The Uptime takeaway: "36 of 84 samples within KPI over 7 days (target 95 %)." */
export function uptimeLine(u: UptimeWindow, w: SampleWindow, target: number): string {
  if (u.samples === 0) return `No evaluable samples in ${WINDOW_LABEL[w]}.`
  return `${count(u.withinKpi)} of ${count(u.samples)} samples within KPI over ${WINDOW_LABEL[w]} (target ${uptime(target)}).`
}

/** The Breaches takeaway: "6 breach episodes in 7 days, the longest 14 h." */
export function episodesLine(eps: readonly BreachEpisode[], w: SampleWindow): string {
  if (!eps.length) return `No breaches in ${WINDOW_LABEL[w]}.`
  const longest = Math.max(...eps.map(episodeHours))
  const n = eps.length === 1 ? '1 breach episode' : `${count(eps.length)} breach episodes`
  if (longest <= 0) return `${n} in ${WINDOW_LABEL[w]}, each a single sample.`
  return `${n} in ${WINDOW_LABEL[w]}, the longest ${hours(longest)}.`
}

/** After the breaches takeaway: "Alerts fire after 3 in a row." */
export function alertsLine(after: number): string {
  return after <= 1
    ? 'Alerts fire on the first breached sample.'
    : `Alerts fire after ${count(after)} in a row.`
}

/** An episode row's middle line: "14 h, ongoing, 8 samples, both sides". */
export function episodeWhat(ep: BreachEpisode): string {
  const parts: string[] = []
  if (ep.samples > 1) parts.push(hours(episodeHours(ep)))
  if (ep.ongoing) parts.push('ongoing')
  parts.push(`${count(ep.samples)} ${ep.samples === 1 ? 'sample' : 'samples'}`)
  parts.push(breachSides(ep.kinds))
  return parts.join(', ')
}

/** The episode's lowest depth on either side; null when both sides were unpriced throughout. */
export function episodeLowest(ep: Pick<BreachEpisode, 'minUpUsd' | 'minDownUsd'>): number | null {
  const vals = [ep.minUpUsd, ep.minDownUsd].filter((v): v is number => v !== null)
  return vals.length ? Math.min(...vals) : null
}

/** "Breached, both sides" for a sample: the scrub caption and the 24 h table speak alike. */
export function sampleWords(p: Pick<MmSampleDto, 'withinKpi' | 'breaches'>): string {
  if (p.withinKpi === null) return 'Not evaluable'
  return p.withinKpi ? 'Within KPI' : `Breached, ${breachSides(p.breaches)}`
}

/** Sentence case for a table cell: "Both sides". */
export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The mandated pool in words: "USDC / AERO, Aerodrome v2", or its DEX and address when unknown. */
export function poolWords(
  poolId: string,
  meta: { token0: { symbol: string }; token1: { symbol: string } } | null | undefined,
): { pair: string; dex: string } {
  const { dex, key } = splitPoolId(poolId)
  const dexName = dex ? dexLabel(dex) : 'Pool'
  if (meta) return { pair: pairLabel(meta.token0, meta.token1), dex: dexName }
  return { pair: shortAddress(key, 4), dex: dexName }
}

/** "Aerodrome v2, 0.3 %": the pool's DEX and fee after its pair. */
export function poolDexFee(meta: { dex: string; feePips: number }): string {
  return `${dexLabel(meta.dex)}, ${fee(meta.feePips)}`
}

/**
 * The eyebrow's second item (§6.7): "Demo Markets on WETH / AERO, Aerodrome Slipstream 0.3 %",
 * or the DEX and short address while the pool is unknown.
 */
export function mandateWhere(
  mandate: { marketMaker: string; poolId: string },
  meta:
    | { token0: { symbol: string }; token1: { symbol: string }; dex: string; feePips: number }
    | null
    | undefined,
): string {
  const words = poolWords(mandate.poolId, meta)
  const where = meta
    ? `${words.pair}, ${dexLabel(meta.dex)} ${fee(meta.feePips)}`
    : `${words.pair}, ${words.dex}`
  return `${mandate.marketMaker} on ${where}`
}

/** "LP share, 1 holder", "2 positions": how the market maker's liquidity was found. */
export function attributionWords(a: { method: string; holdings: number } | null): string {
  if (!a) return '—'
  const n = count(a.holdings)
  if (a.method === 'lp-share') return `LP share, ${n} ${a.holdings === 1 ? 'holder' : 'holders'}`
  if (a.method === 'positions') return `${n} ${a.holdings === 1 ? 'position' : 'positions'}`
  return 'None found'
}

/** "$50K per side within ±2 %". */
export function minDepthWords(kpis: { minDepthUsd: number; bandPct: number }): string {
  return `${usd(kpis.minDepthUsd)} per side within ±${kpis.bandPct}${NB}%`
}

/** "40 bps at $10K", or "None". */
export function maxSpreadWords(kpis: {
  maxSpreadBps: number | null
  spreadNotionalUsd: number
}): string {
  return kpis.maxSpreadBps === null
    ? 'None'
    : `${bps(kpis.maxSpreadBps)} at ${usd(kpis.spreadNotionalUsd)}`
}

/** "0xa29d93f3…f0a0f7": an address short enough for the Mandate list, long enough to check. */
export function midAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address
}
