/**
 * Scales and ticks for the hand-drawn charts (docs/design/visual-v3.md §5.9, §7): `linear`,
 * `niceStep` and `ticks`. Pure: no DOM. Ticks fall
 * on round values and on time landmarks only (CH1): `0, 5M, 10M`, `00:00, 06:00`, day names, never
 * `06:56`.
 */
import { clockTime, day, weekday } from './format.js'

export interface Linear {
  (v: number): number
  /** The domain value at range position `x`. */
  invert(x: number): number
}

/** A linear map from [d0, d1] to [r0, r1]; a zero-width domain maps everything to r0. */
export function linear(d0: number, d1: number, r0: number, r1: number): Linear {
  const k = (r1 - r0) / (d1 - d0 || 1)
  const f = ((v: number) => r0 + (v - d0) * k) as Linear
  f.invert = (x: number) => d0 + (x - r0) / (k || 1)
  return f
}

/** Rounds away float noise (0.30000000000000004 → 0.3) so ticks print as typed. */
function tidy(v: number): number {
  return Number(v.toPrecision(12))
}

/** A round step (1, 2 or 5 × 10ⁿ) splitting `span` into about `count` parts. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / Math.max(1, count)
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return tidy((m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p)
}

/** The multiples of `niceStep(max − min, count)` inside [min, max]. */
export function ticks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return []
  if (max === min) return [tidy(min)]
  const step = niceStep(max - min, count)
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    out.push(tidy(Math.round(v / step) * step))
  return out
}

/**
 * The top of a zero-based axis: the last nice tick when it covers `max`, else one step more (the
 * curve's y axis and the lollipop's bps axis).
 */
export function niceTop(max: number, count = 3): number {
  if (!(max > 0)) return 1
  const t = ticks(0, max, count)
  const last = t[t.length - 1] ?? max
  return last >= max ? last : tidy(last + niceStep(max, count))
}

/**
 * The mirrored curve's log-spaced x (CH3): `cx ± log(1 + |p|) / log 6 × half`, so ±1, ±2 and ±5 %
 * spread out evenly and ±5 % lands on the edge.
 */
export function logPctX(pct: number, cx: number, half: number): number {
  return cx + Math.sign(pct) * (Math.log(1 + Math.abs(pct)) / Math.log(6)) * half
}

/** `M x y L x y …` with 2-decimal coordinates. */
export function pathD(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

/**
 * The y domain of a small multiple (CH5): the values and the optional band, padded 18 %, floored
 * at 0. Line axes may crop, but never to a span under `minSpan` × the window median, so 1 % noise
 * stays flat (a 10.3–10.4 bps spread series reads as flat; visual-v3.md §5.9).
 */
export function seriesDomain(
  values: readonly number[],
  opts: {
    band?: readonly [number, number] | null
    minSpan?: number
    /** A reference value (a KPI line) the domain must show. */
    reference?: number | null
  } = {},
): [number, number] {
  const vals = values.filter(Number.isFinite)
  if (!vals.length) return [0, 1]
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (opts.band) {
    lo = Math.min(lo, opts.band[0])
    hi = Math.max(hi, opts.band[1])
  }
  if (opts.reference !== undefined && opts.reference !== null && Number.isFinite(opts.reference)) {
    lo = Math.min(lo, opts.reference)
    hi = Math.max(hi, opts.reference)
  }
  const med = median(vals)
  if (opts.minSpan && med !== null) {
    const need = Math.abs(med) * opts.minSpan
    if (hi - lo < need) {
      const c = (hi + lo) / 2
      lo = c - need / 2
      hi = c + need / 2
    }
  }
  const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.1 || 1
  return [Math.max(0, lo - pad), hi + pad]
}

export interface TimeTick {
  t: number
  label: string
}

const HOUR = 3600
const DAY = 86_400

/**
 * Time landmarks (CH1, CH5) for a window `span` seconds long, inside `domain` (unix seconds, UTC):
 * every 6 hours ("06:00") up to 2 days, weekday names ("Mon") up to 10 days, a weekly "16 Oct"
 * beyond. The span is the window's, so a range morph keeps one tick vocabulary while the domain
 * moves.
 */
export function timeTicks(domain: readonly [number, number], span: number): TimeTick[] {
  const [t0, t1] = domain
  const out: TimeTick[] = []
  if (!(t1 > t0)) return out
  if (span <= 2 * DAY) {
    for (let t = Math.ceil(t0 / (6 * HOUR)) * 6 * HOUR; t <= t1; t += 6 * HOUR)
      out.push({ t, label: clockTime(t) })
    return out
  }
  const weekly = span > 10 * DAY
  for (let t = Math.ceil(t0 / DAY) * DAY; t <= t1; t += weekly ? 7 * DAY : DAY)
    out.push({ t, label: weekly ? day(t) : weekday(t) })
  return out
}

/** The ticks whose x (from `fx`) keeps `edge` px clear of both ends of [x0, x1]. */
export function clearOfEdges(
  list: readonly TimeTick[],
  fx: (t: number) => number,
  x0: number,
  x1: number,
  edge = 14,
): TimeTick[] {
  return list.filter(({ t }) => {
    const x = fx(t)
    return x >= x0 + edge && x <= x1 - edge
  })
}

/** Linear interpolation of two [lo, hi] pairs at progress `e`. */
export function mix2(
  a: readonly [number, number],
  b: readonly [number, number],
  e: number,
): [number, number] {
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]
}

/**
 * The halftone lattice pitch (§3.7): 5 CSS px on desktop and 4 on phones, snapped to whole device
 * pixels so fractional DPRs never beat into moiré.
 */
export function latticePitch(dpr: number, phone: boolean): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  return Math.round((phone ? 4 : 5) * d) / d
}
