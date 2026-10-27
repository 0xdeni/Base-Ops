/**
 * The bullet graph (CH8, docs/design/visual-v3.md §5.9): a 6 px `text-1` bar on a `border-subtle`
 * track with a 2 × 14 `text-2` target tick; 96 px in lists, up to 220 px in facts. Scorecard depth
 * bullets scale to 1.5× the KPI, so the tick sits at two thirds (`depthBullet`); uptime bullets
 * scale 0–100 % with the tick at the target.
 */
import { vars } from './useChartWidth.js'
import './glyphs.css'

export interface BulletScale {
  value: number | null
  target: number
  max: number
}

/** A depth bullet: the KPI tick at two thirds of a 1.5 × KPI track. */
export function depthBullet(value: number | null, kpi: number): BulletScale {
  return { value, target: kpi, max: kpi * 1.5 }
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
  /** Fill the fact column (up to 220 px) instead of 96 px. */
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
      <i className="b-fill" />
      <b className="b-tick" />
    </span>
  )
}
