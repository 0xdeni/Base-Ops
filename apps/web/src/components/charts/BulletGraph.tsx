/**
 * The bullet graph (CH8, docs/design/visual-v4.md §5.6): a 10 px bar to the value with a 3 × 20
 * target tick. In the ink block (scorecard facts) it is a Gray 80 track with an `--on-ink` fill, up
 * to 240 px wide; in light rows an ink fill on a `--surface-2` track, 96 px wide. Depth bullets
 * scale to 1.25 × the larger of the KPI and the value (`depthBullet`), so neither ever touches the
 * end; uptime bullets scale 0–100 % with the tick at the target.
 */
import { vars } from './useChartWidth.js'
import './glyphs.css'

export interface BulletScale {
  value: number | null
  target: number
  max: number
}

/** A depth bullet: the track ends at 1.25 × the larger of the KPI and the value. */
export function depthBullet(value: number | null, kpi: number): BulletScale {
  return { value, target: kpi, max: 1.25 * Math.max(kpi, value ?? 0) }
}

/** The fill and tick positions as fractions of the track. */
export function bulletFractions({ value, target, max }: BulletScale): { v: number; t: number } {
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return {
    v: max > 0 && value !== null ? clamp(value / max) : 0,
    t: max > 0 ? clamp(target / max) : 0,
  }
}

export function BulletGraph({
  value,
  target,
  max = 1,
  label,
  wide = false,
}: Omit<BulletScale, 'max'> & {
  /** The end of the track; 1 for shares (uptime). */
  max?: number
  /** The accessible sentence: "7 day uptime 42.9 % against a 95 % target". */
  label: string
  /** Fill the fact column (up to 240 px) instead of 96 px. */
  wide?: boolean
}) {
  const f = bulletFractions({ value, target, max })
  return (
    <span
      className={`bullet${wide ? ' wide' : ''}`}
      role="img"
      aria-label={label}
      style={vars({ '--v': f.v, '--t': f.t })}
    >
      <i className="b-fill" data-bar="" />
      <b className="b-tick" />
    </span>
  )
}
