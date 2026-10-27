/**
 * Scales of the market-maker chart (docs/design/visual-v3.md §5.9 "Market-maker chart"): the buy
 * side above a zero line and the sell side mirrored below it on one symmetric scale, the KPI on
 * both sides, magnitude ticks at KPI multiples clear of the KPI and zero labels, and the breach
 * bands. Pure.
 */
import type { MmSampleDto } from '../../api/types.js'
import { usd, usdTick } from '../../lib/format.js'
import { niceStep, ticks } from '../../lib/scale.js'
import { type BreachEpisode, breachSides } from '../../lib/scorecard.js'

/**
 * The symmetric scale's half-height: `ceil(max(1.25 × KPI, values) × 1.08 / step) × step`, where
 * the values are the market maker's depth per side, plus the whole pool's with the context on.
 */
export function mmScaleMax(
  kpi: number,
  points: readonly Pick<MmSampleDto, 'attribution'>[],
  wholePool: boolean,
): number {
  let m = kpi * 1.25
  for (const p of points) {
    const a = p.attribution
    const vals = [a.depthUpUsd, a.depthDownUsd]
    if (wholePool) vals.push(a.poolDepthUpUsd, a.poolDepthDownUsd)
    for (const v of vals) if (v !== null && Number.isFinite(v) && v > m) m = v
  }
  if (!(m > 0)) return 1
  const step = niceStep(m, 3)
  return Math.ceil((m * 1.08) / step) * step
}

/**
 * Gutter labels keep at least this far apart (12 px figures, so about 12 px of air between them);
 * a KPI line nearer than this to zero merges with the "0" label.
 */
export const LABEL_GAP = 24

/** The KPI multiples a magnitude tick may sit at (docs/design/visual-v3.md §5.9). */
const KPI_MULTIPLES: readonly number[] = [0.5, 1.5, 2, 3]

export interface MmYLabel {
  /** Signed: buy side above zero, sell side below. */
  v: number
  text: string
  /** The KPI labels are `text-2`; the rest `text-3`. */
  strong: boolean
}

/**
 * The y labels of the right gutter (§5.9): "KPI $50K" on both sides and "0" at the
 * zero line, merged into one "KPI ±$250K" at the zero line when the KPI lines sit under
 * `LABEL_GAP` from it (the whole-pool context makes the scale tens of times the KPI). Then up to
 * two magnitude ticks per side at 0.5×, 1.5×, 2× or 3× the KPI, each below 0.97 M, at least 0.2 M
 * from the KPI and `LABEL_GAP` from every other label: $25K and $75K around a $50K KPI. Only when
 * no multiple fits (the merged whole-pool scale) do nice values of the scale stand in.
 */
export function mmYLabels(kpi: number, M: number, fy: (v: number) => number): MmYLabel[] {
  const px = (a: number, b: number) => Math.abs(fy(a) - fy(b))
  const merged = px(kpi, 0) < LABEL_GAP
  const out: MmYLabel[] = merged
    ? [{ v: 0, text: `KPI ±${usd(kpi)}`, strong: true }]
    : [
        { v: kpi, text: `KPI ${usd(kpi)}`, strong: true },
        { v: -kpi, text: `KPI ${usd(kpi)}`, strong: true },
        { v: 0, text: '0', strong: false },
      ]
  const taken = merged ? [0] : [0, kpi]
  const clear = (v: number, kept: readonly number[]) =>
    v > 0 && v < M * 0.97 && [...taken, ...kept].every((t) => px(v, t) >= LABEL_GAP)
  // A tick's 2-figure label must name its value exactly ($125K would read "$130K").
  const exact = (v: number) => Number(v.toPrecision(2)) === v
  const mags: number[] = []
  for (const v of KPI_MULTIPLES.map((f) => kpi * f)) {
    if (mags.length < 2 && exact(v) && Math.abs(v - kpi) >= M * 0.2 && clear(v, mags)) mags.push(v)
  }
  if (!mags.length) {
    // The merged scale: the coarsest nice step that leaves two clear values, the outer two kept.
    let found: number[] = []
    for (const count of [2, 3, 4, 5]) {
      const kept: number[] = []
      for (const v of ticks(0, M, count)) if (clear(v, kept)) kept.push(v)
      if (kept.length > found.length) found = kept
      if (found.length >= 2) break
    }
    mags.push(...(found.length > 2 ? [found[0] ?? 0, found[found.length - 1] ?? 0] : found))
  }
  for (const v of mags)
    out.push({ v, text: usdTick(v), strong: false }, { v: -v, text: usdTick(v), strong: false })
  return out
}

/** A breach band spans its samples' intervals: `start − interval / 2` to `end + interval / 2`. */
export function bandSpan(
  ep: Pick<BreachEpisode, 'start' | 'end'>,
  interval: number,
): [number, number] {
  return [ep.start - interval / 2, ep.end + interval / 2]
}

/** The scrub caption's status: shape tone and words ("Breached, both sides"). */
export function sampleStatus(p: Pick<MmSampleDto, 'withinKpi' | 'breaches'>): {
  tone: 'ok' | 'bad' | 'none'
  text: string
} {
  if (p.withinKpi === null) return { tone: 'none', text: 'Not evaluable' }
  if (p.withinKpi) return { tone: 'ok', text: 'Within KPI' }
  return { tone: 'bad', text: `Breached, ${breachSides(p.breaches)}` }
}

export function mmLabel(
  windowLabel: string,
  kpi: number,
  episodes: number,
  latest: Pick<MmSampleDto, 'attribution'> | undefined,
): string {
  const now = latest
    ? ` Latest: buy side ${usd(latest.attribution.depthUpUsd)}, sell side ${usd(latest.attribution.depthDownUsd)}.`
    : ''
  return `Market-maker depth per side over ${windowLabel} against the ${usd(kpi)} KPI. ${episodes} breach ${episodes === 1 ? 'episode' : 'episodes'} shown as shaded bands.${now} Use the arrow keys to step through samples.`
}
