/**
 * The weighted health bar (CH8, ia-v3 §4.3, docs/design/visual-v3.md §5.9): four segments in a
 * `35fr 25fr 20fr 20fr` grid with 2 px gaps, each filled in `text-1` to its component ÷ weight on a
 * `border-subtle` track. 8 px in the Health section, with each component's name and weight under
 * its segment and the weakest in `text-1`; 4 px at 80 px in tables (`mini`). The score itself stays
 * in the facts row (ia-v3 §4.3). Below 600 px the names stagger on two rows, so none is ellipsized.
 */
import { HEALTH_MAX, type HealthComponents } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { scoreExact } from '../../lib/format.js'
import { ShowData } from './ShowData.js'
import { vars } from './useChartWidth.js'
import './charts.css'
import './glyphs.css'

export const HEALTH_PARTS: ReadonlyArray<{ key: keyof HealthComponents; label: string }> = [
  { key: 'depth', label: 'Depth' },
  { key: 'spread', label: 'Spread' },
  { key: 'concentration', label: 'Concentration' },
  { key: 'persistence', label: 'Persistence' },
]

/** Each component as a fraction of its weight, clamped to [0, 1]. */
export function healthFill(c: HealthComponents, key: keyof HealthComponents): number {
  const max = HEALTH_MAX[key]
  return max > 0 ? Math.min(1, Math.max(0, c[key] / max)) : 0
}

/** The component furthest below its weight (the Health takeaway names it). */
export function weakestPart(c: HealthComponents): keyof HealthComponents {
  let weakest: keyof HealthComponents = 'depth'
  for (const { key } of HEALTH_PARTS) if (healthFill(c, key) < healthFill(c, weakest)) weakest = key
  return weakest
}

export function healthLabel(c: HealthComponents): string {
  return HEALTH_PARTS.map(
    ({ key, label }) => `${label} ${scoreExact(c[key])} of ${HEALTH_MAX[key]}`,
  ).join(', ')
}

export function HealthBar({
  components,
  mini = false,
  children,
}: {
  components: HealthComponents
  /** The 80 × 4 table glyph, without names. */
  mini?: boolean
  children?: ReactNode
}) {
  const weakest = weakestPart(components)
  const bar = (
    <div className={`hbar${mini ? ' mini' : ''}`} role="img" aria-label={healthLabel(components)}>
      {HEALTH_PARTS.map(({ key }) => (
        <span key={key} className="seg-h">
          <i className="h-fill" style={vars({ '--v': healthFill(components, key) })} />
        </span>
      ))}
    </div>
  )
  if (mini) return bar
  return (
    <>
      <div className="hbar-wrap">
        {bar}
        <div className="hbar-names" aria-hidden="true">
          {HEALTH_PARTS.map(({ key, label }) => (
            <span key={key} className={key === weakest ? 'weak' : undefined}>
              {label} <span className="faint">{HEALTH_MAX[key]}</span>
            </span>
          ))}
        </div>
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
