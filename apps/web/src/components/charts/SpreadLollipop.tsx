/**
 * Cost to trade (docs/design/visual-v3.md §5.9 "Cost-to-trade lollipop"): the effective spread of
 * a $1K, $10K and $100K round trip as lollipops on one shared bps axis from 0, so each spread reads
 * as a length. A 3 px `text-1` stem, a 10 px dot and the value 14 px to its right (or to its left
 * on a canvas patch past 72 % of the axis). A notional the pool cannot absorb (infeasible, or a
 * stored spread of 10,000 bps or more) is a hollow ring at 0 labelled "Can’t absorb". Nice ticks;
 * the last carries the dotted "bps" glossary term.
 */
import type { ReactNode } from 'react'
import type { SpreadPoint } from '../../api/types.js'
import { bps, NB, SPREAD_UNABSORBED_BPS, usd } from '../../lib/format.js'
import { niceTop, ticks } from '../../lib/scale.js'
import { Glossary } from '../ui/Glossary.js'
import { ShowData } from './ShowData.js'
import { vars } from './useChartWidth.js'
import './charts.css'
import './glyphs.css'

/** The axis maximum and the ticks before it (the last tick is printed with its unit). */
export function lollipopAxis(spreads: readonly SpreadPoint[]): { max: number; ticks: number[] } {
  const top = Math.max(0, ...spreads.map((s) => (fillable(s) ? s.spreadBps : 0)))
  const max = niceTop(top, 3)
  return { max, ticks: ticks(0, max, 3).filter((v) => v < max) }
}

const fillable = (s: SpreadPoint): s is SpreadPoint & { spreadBps: number } =>
  s.feasible && s.spreadBps !== null && Math.round(Math.abs(s.spreadBps)) < SPREAD_UNABSORBED_BPS

export function lollipopLabel(spreads: readonly SpreadPoint[]): string {
  return `Effective spread: ${spreads
    .map(
      (s) =>
        `${usd(s.notionalUsd)} ${fillable(s) ? `costs ${bps(s.spreadBps)}` : 'can’t be absorbed'}`,
    )
    .join(', ')}.`
}

export function SpreadLollipop({
  spreads,
  children,
}: {
  spreads: readonly SpreadPoint[]
  children?: ReactNode
}) {
  const axis = lollipopAxis(spreads)
  // One root, so in a section's body grid the axis sits right under the rows, as in the figure.
  return (
    <div className="lolli">
      <div className="dotplot" role="img" aria-label={lollipopLabel(spreads)}>
        {spreads.map((s) => {
          const x = fillable(s) ? Math.min(1, Math.max(0, s.spreadBps / axis.max)) : 0
          return (
            <div className="dp-row" key={s.notionalUsd}>
              <span className="k num">{usd(s.notionalUsd)}</span>
              <span className="dp-track" style={vars({ '--x': x })}>
                {fillable(s) ? (
                  <>
                    <span className="dp-stem" />
                    <span className="dp-dot" />
                    <span className={`dp-val num${x > 0.72 ? ' to-left' : ''}`}>
                      {bps(s.spreadBps)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="dp-hollow" />
                    <span className="dp-val faint">Can’t absorb</span>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <div className="dp-axis">
        {axis.ticks.map((v) => (
          <span key={v} style={{ left: `${(v / axis.max) * 100}%` }} aria-hidden="true">
            {v}
          </span>
        ))}
        <span className="dp-last">
          {axis.max}
          {NB}
          <Glossary
            definition={`Basis points: hundredths of a percent. 10${NB}bps is 0.1${NB}%.`}
            anchor="spread"
          >
            bps
          </Glossary>
        </span>
      </div>
      <ShowData>{children}</ShowData>
    </div>
  )
}
