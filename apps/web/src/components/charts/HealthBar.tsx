/**
 * The weighted health bar (CH8, ia-v3 §4.3, docs/design/visual-v4.md §5.9.8): four segments sized
 * 35 : 25 : 20 : 20 with 4 px gaps, 16 px tall, each a `--surface-2` track filled in ink to its
 * component ÷ weight. Under each, the name (the weakest underlined) and "33.7 of 35"; below 600 px
 * the names sit in a 2 × 2 grid. The score itself stays in the facts (ia-v3 §4.3). `mini` is the
 * 80 × 4 table glyph without names.
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
    <div className={`wbar${mini ? ' mini' : ''}`} role="img" aria-label={healthLabel(components)}>
      {HEALTH_PARTS.map(({ key }) => (
        <span key={key} className="wseg" style={{ flexGrow: HEALTH_MAX[key] }}>
          <i className="wfill" style={vars({ '--f': healthFill(components, key) })} />
        </span>
      ))}
    </div>
  )
  if (mini) return bar
  return (
    <>
      <div className="wbar-wrap">
        {bar}
        <div className="wbar-l" aria-hidden="true">
          {HEALTH_PARTS.map(({ key, label }) => (
            <span
              key={key}
              className={`wlab${key === weakest ? ' weak' : ''}`}
              style={{ flexGrow: HEALTH_MAX[key] }}
            >
              <b>{label}</b>
              <span className="cap">
                {scoreExact(components[key])} of {HEALTH_MAX[key]}
              </span>
            </span>
          ))}
        </div>
      </div>
      <ShowData>{children}</ShowData>
    </>
  )
}
