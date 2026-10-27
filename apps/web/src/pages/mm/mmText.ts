/**
 * The words of the scorecard screens (ia-v3 §4.5–§4.6 as amended, docs/design/visual-v3.md
 * §6.5–§6.6): answer sentences, fact labels, section takeaways and row lines. Pure: every number is read
 * as the API stored it (core's uptime, streak, worst excursions and stored KPI evaluations) and only
 * formatted here; marks come from `sampleMark`, so a label never contradicts the status.
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
 * The scorecard's answer (ia-v3 §4.6): the current streak and since when. With a fourth (spread)
 * fact the "since …" clause is dropped to stay within the first-viewport budget.
 */
export function scorecardAnswer(
  sc: Pick<ScorecardSummaryDto, 'mandate' | 'latest' | 'streak'>,
  now: number,
  withSince = true,
): string {
  if (!sc.mandate.active) {
    return sc.latest
      ? `Inactive since its last sample, ${ago(sc.latest.timestamp, now)}.`
      : 'Inactive, with no samples.'
  }
  const { streak } = sc
  if (!sc.latest || streak.samples === 0) return 'No samples yet.'
  const state = streak.breached ? 'Breached' : 'Within KPI'
  if (streak.samples === 1) {
    return withSince
      ? `${state} at the latest sample, ${ago(sc.latest.timestamp, now)}.`
      : `${state} at the latest sample.`
  }
  const since = withSince && streak.since !== null ? `, since ${ago(streak.since, now)}` : ''
  return `${state} for ${count(streak.samples)} consecutive samples${since}.`
}

/** The list's answer (ia-v3 §4.5): "1 of 2 mandates is within its KPIs right now." */
export function listAnswer(items: readonly Pick<ScorecardSummaryDto, 'mandate' | 'status'>[]) {
  if (!items.length) return 'No market-maker mandates are registered yet.'
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

/** "uptime, 7 d, below the 95 % target" (ia-v3 §4.6). */
export function uptimeLabel(u: Pick<UptimeWindow, 'uptime'>, target: number): string {
  if (u.uptime === null) return `uptime, 7${NB}d, no evaluable samples`
  const word = u.uptime < target ? 'below' : 'meets'
  return `uptime, 7${NB}d, ${word} the ${uptime(target)} target`
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

/** "Aerodrome v2, 0.3 %": the meta line's pool description. */
export function poolDexFee(meta: { dex: string; feePips: number }): string {
  return `${dexLabel(meta.dex)}, ${fee(meta.feePips)}`
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
