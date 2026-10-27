/**
 * The words of Home (ia-v3 §4.1, docs/design/visual-v3.md §6.1), kept pure so the sentences can be
 * tested without rendering. Every number is formatted here from stored values; nothing is derived.
 */
import type { GapItem, ScorecardSummaryDto } from '../../api/types.js'
import { MEANINGFUL_GAP_TURNOVER } from '../../components/charts/TurnoverGlyph.js'
import { NB, usd } from '../../lib/format.js'

/** The display answer (P3): "$26.1M sits within 2 % of the price on Base." */
export function homeAnswer(depth2Usd: number): string {
  return `${usd(depth2Usd)} sits within 2${NB}% of the price on Base.`
}

/** The answer before the first score exists. */
export const EMPTY_ANSWER = 'No pools are scored yet.'

/**
 * The one-sentence lead under the answer (P8), with the scored-pool count and how many of them
 * are deep enough to be graded.
 */
export function homeLead(scored: number, rated: number): string {
  const subject =
    scored === 1
      ? 'its one scored Uniswap or Aerodrome pool'
      : `each of ${scored} Uniswap and Aerodrome pools`
  let grading: string
  if (rated === 0)
    grading = scored === 1 ? 'but it is too thin to grade' : 'but none is deep enough to grade'
  else if (rated === scored)
    grading = scored === 1 ? 'and grades it A to F' : 'and grades them A to F'
  else grading = `and grades the ${rated} deep enough to rate A to F`
  return `Depthwatch measures what it costs to move ${subject}, ${grading}.`
}

/** The lead while nothing is scored: what was found, and when scores appear. */
export function emptyLead(discovered: number): string {
  const found = discovered === 1 ? '1 pool discovered.' : `${discovered} pools discovered.`
  return `${found} Scores appear after the first snapshot.`
}

/** A pool trading 3× its ±2 % depth a day or more (the same threshold on every screen, TB9). */
export function isMeaningfulGap(item: GapItem): boolean {
  const t = item.gap.turnoverRatio
  return t !== null && t >= MEANINGFUL_GAP_TURNOVER
}

/** "1 pool trades 3× its depth or more every day." / "No pool trades 3× its depth today." */
export function gapsTakeaway(meaningful: number): string {
  if (meaningful === 0) return 'No pool trades 3× its depth today.'
  if (meaningful === 1) return '1 pool trades 3× its depth or more every day.'
  return `${meaningful} pools trade 3× their depth or more every day.`
}

/** The quiet line under fewer than 3 gap rows. */
export const GAPS_QUIET_LINE = 'Every other pool trades less than 3× its depth.'

/** "Trades 51× its depth a day". */
export function tradesLine(ratioText: string): string {
  return `Trades ${ratioText} its depth a day`
}

/**
 * The scorecards takeaway around its glossary term: "1 of 2 mandates is within its [KPIs] right
 * now." Every registered mandate counts, as on the Scorecards list.
 */
export function mandatesTakeaway(items: readonly Pick<ScorecardSummaryDto, 'status'>[]): {
  before: string
  after: string
} {
  const ok = items.filter((s) => s.status === 'ok').length
  const n = items.length
  const noun = n === 1 ? 'mandate' : 'mandates'
  const verb = ok === 1 || (ok === 0 && n === 1) ? 'is' : 'are'
  const their = ok === 1 || n === 1 ? 'its' : 'their'
  return { before: `${ok} of ${n} ${noun} ${verb} within ${their} `, after: ' right now.' }
}

/** The definitions behind the dotted terms on Home (D8); Methodology has the full text. */
export const GLOSS = {
  health:
    'One score from 0 to 100 built from depth, spread, concentration and persistence. A is 80 or more. A pool too thin to rate gets no grade.',
  gap: `A pool that trades far more each day than the liquidity within 2${NB}% of its price.`,
  turnover: `How many times a pool trades its own depth within 2${NB}% of the price in a day.`,
  kpis: 'The depth a market maker promised to keep on each side, checked at every snapshot.',
} as const
