/**
 * Cost to trade (docs/design/visual-v4.md §5.9.8): the effective spread of a $1K, $10K and $100K
 * round trip as lollipops on one shared bps axis from 0, so each spread reads as a length. Rows of
 * 40 px: the notional in a 56 px column, a 2 px `--line` track, a 4 px ink stem from 0 to the
 * value, a 16 px rounded square dot and the value 16 px after it. A notional the pool cannot absorb
 * (infeasible, or a stored spread of 10,000 bps or more) is a hollow ring at 0 labelled "Can’t
 * absorb $100K". The axis reads 0 and three nice ticks, the last with the "bps" glossary term.
 */
import type { ReactNode } from 'react'
import type { SpreadPoint } from '../../api/types.js'
import { bps, cantAbsorb, NB, SPREAD_UNABSORBED_BPS, usd } from '../../lib/format.js'
import { niceStepUp } from '../../lib/scale.js'
import { Glossary } from '../ui/Glossary.js'
import { ShowData } from './ShowData.js'
import { vars } from './useChartWidth.js'
import './charts.css'
import './glyphs.css'

const fillable = (s: SpreadPoint): s is SpreadPoint & { spreadBps: number } =>
  s.feasible && s.spreadBps !== null && Math.round(Math.abs(s.spreadBps)) < SPREAD_UNABSORBED_BPS

/** The axis: three equal round steps from 0 past the widest fillable spread. */
export function lollipopAxis(spreads: readonly SpreadPoint[]): { max: number; ticks: number[] } {
  const top = Math.max(0, ...spreads.map((s) => (fillable(s) ? s.spreadBps : 0)))
  const step = niceStepUp(top > 0 ? top : 1, 3)
  return { max: step * 3, ticks: [0, step, step * 2, step * 3].map((v) => Number(v.toPrecision(12))) }
}

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
  return (
    <div className="lolli">
      <div className="dots" role="img" aria-label={lollipopLabel(spreads)}>
        {spreads.map((s) => {
          const ok = fillable(s)
          const x = ok ? Math.min(1, Math.max(0, s.spreadBps / axis.max)) : 0
          return (
            <div className="dot-r" key={s.notionalUsd}>
              <span className="k num">{usd(s.notionalUsd)}</span>
              <span className="dot-t" style={vars({ '--x': x })}>
                {ok ? <i className="dot-s" data-bar="" /> : null}
                <i className={`dot-d${ok ? '' : ' ring'}`} />
                <b className="num">{ok ? bps(s.spreadBps) : cantAbsorb(s.notionalUsd)}</b>
              </span>
            </div>
          )
        })}
      </div>
      <div className="dot-r dot-ax">
        <span />
        <span className="dot-t">
          {axis.ticks.map((v, i) => (
            <span
              key={v}
              className={i === axis.ticks.length - 1 ? 'dp-last' : undefined}
              style={vars({ '--x': v / axis.max })}
              aria-hidden={i === axis.ticks.length - 1 ? undefined : true}
            >
              {i === 0 ? (
                '0'
              ) : i === axis.ticks.length - 1 ? (
                <>
                  {v}
                  {NB}
                  <Glossary
                    definition={`Basis points: hundredths of a percent. 10${NB}bps is 0.1${NB}%.`}
                    anchor="spread"
                  >
                    bps
                  </Glossary>
                </>
              ) : (
                `${v}${NB}bps`
              )}
            </span>
          ))}
        </span>
      </div>
      <ShowData>{children}</ShowData>
    </div>
  )
}
