/**
 * The depth butterfly (CH4, ia-v3 §4.1, docs/design/visual-v3.md §5.9): the Home and
 * Token focal. One row per pool, sell side left and buy side right of the spine, on one shared
 * linear scale set by the scope's own total, closed by the "All of …" total row drawn as the field
 * of light (§3.7). The lens (§4 rows 3–5): hover, focus or tap a row and its stratum leaves the
 * stack and slides to the spine over 280 ms while the rest of the scope stays as a dimmed ghost;
 * focus lenses instantly, row to row only cross-fades, reduced motion fades in place. The first
 * view grows the bars from the spine (`intro`, §4 rows 1–2).
 */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PoolSummary } from '../../api/types.js'
import { NB, poolHref, ratio, shareOf, usd, usdTick } from '../../lib/format.js'
import { animate, DUR, EASE, prefersReducedMotion } from '../../lib/motion.js'
import {
  axisTicks,
  butterflyLabel,
  butterflyModel,
  gapMarkerTight,
  pickButterflyRows,
  rowLinkLabel,
  type Stratum,
  strataBoundaries,
} from './butterflyModel.js'
import { ShowData } from './ShowData.js'
import { vars } from './useChartWidth.js'
import './charts.css'
import './butterfly.css'
import './butterflyStates.css'

export interface ButterflyGap {
  poolId: string
  turnoverRatio: number
}

export interface DepthButterflyProps {
  /** Every pool in scope: the total row sums them all. */
  pools: readonly PoolSummary[]
  /** The listed rows; defaults to `pickButterflyRows(pools, gap?.poolId)`. */
  rows?: readonly PoolSummary[]
  /** The biggest meaningful gap (turnover ≥ 3×): its row carries the "Gap" marker. */
  gap?: ButterflyGap | null
  /** "Base" on Home, the token symbol on a token page. */
  scope?: string
  /** First view of the session: the bars grow from the spine (M6). */
  intro?: boolean
  /** Below the axis, e.g. a "Show all 312 pools" link. */
  more?: ReactNode
  /** The "Show data" table (CH9). */
  children?: ReactNode
}

type LensHow = 'slide' | 'fade' | 'instant'

function TotalSide({
  side,
  value,
  strata,
  width,
  track,
  lens,
  lensRef,
}: {
  side: 'sell' | 'buy'
  value: number
  strata: Stratum[]
  width: number
  track: number
  lens: Stratum | null
  lensRef: (el: HTMLSpanElement | null) => void
}) {
  return (
    <span className={`bf-side ${side}`}>
      <span className="bf-track tot-track" data-side={side}>
        <span className="tot-field" style={vars({ '--w': width })} />
        {strataBoundaries(strata, track).map((o) => (
          <i key={o} className="tot-sep" style={vars({ '--o': o })} />
        ))}
        <span className="tot-cap" style={vars({ '--w': width })} />
        <span
          ref={lensRef}
          className={`tot-lens${lens ? ' on' : ''}`}
          style={vars({ '--w': lens ? lens.w : 0 })}
        />
        <span className="bf-val tot-val" style={vars({ '--w': width })}>
          {usd(value)}
        </span>
      </span>
    </span>
  )
}

export function DepthButterfly({
  pools,
  rows: rowsProp,
  gap = null,
  scope = 'Base',
  intro = false,
  more,
  children,
}: DepthButterflyProps) {
  const rows = rowsProp ?? pickButterflyRows(pools, gap?.poolId)
  const m = butterflyModel(rows, pools)
  const figRef = useRef<HTMLElement | null>(null)
  const lensEls = useRef<{ sell: HTMLSpanElement | null; buy: HTMLSpanElement | null }>({
    sell: null,
    buy: null,
  })
  const [lens, setLens] = useState(-1)
  const [instant, setInstant] = useState(false)
  const [grow, setGrow] = useState(intro)
  const [track, setTrack] = useState(480)
  const cur = useRef(-1)
  const how = useRef<LensHow | null>(null)

  // The intro plays once; afterwards re-renders never replay it.
  useEffect(() => {
    if (!grow) return
    const t = setTimeout(() => setGrow(false), 600)
    return () => clearTimeout(t)
  }, [grow])

  const drawn = m.rows.length > 0 && m.max > 0
  // The total track's width: strata gaps under 3 px are skipped, and the lens slides this far.
  useLayoutEffect(() => {
    const el = drawn ? figRef.current?.querySelector<HTMLElement>('.tot-track') : null
    if (!el) return
    const read = () => el.clientWidth > 0 && setTrack(el.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [drawn])

  const set = (k: number, mode: 'pointer' | 'instant') => {
    if (k === cur.current) return
    const prev = cur.current
    cur.current = k
    how.current =
      k < 0 || mode === 'instant'
        ? 'instant'
        : prev >= 0 || prefersReducedMotion()
          ? 'fade'
          : 'slide'
    setInstant(mode === 'instant')
    setLens(k)
  }

  // Lens enter: the stratum starts where it sits in the stack and slides to the spine (WAAPI,
  // cancelling any previous slide); from one lensed row to the next it only cross-fades (M2).
  useLayoutEffect(() => {
    const mode = how.current
    if (mode === null) return
    how.current = null
    for (const side of ['sell', 'buy'] as const) {
      const el = lensEls.current[side]
      if (!el) continue
      for (const a of el.getAnimations?.() ?? []) a.cancel()
      const s = lens >= 0 ? m.strata[side][lens] : null
      if (!s || mode === 'instant') continue
      if (mode === 'fade')
        animate(el, [{ opacity: 0.4 }, { opacity: 1 }], { duration: DUR.settle, easing: 'ease' })
      else {
        const dx = (side === 'sell' ? -1 : 1) * s.o * (el.parentElement?.clientWidth ?? track)
        animate(el, [{ transform: `translateX(${dx}px)` }, { transform: 'none' }], {
          duration: DUR.morph,
          easing: EASE.inOut,
        })
      }
    }
  })

  // A tap or click outside the figure ends the lens.
  useEffect(() => {
    if (lens < 0) return
    const outside = (e: PointerEvent) => {
      if (!figRef.current?.contains(e.target as Node)) set(-1, 'pointer')
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  })

  const rowOf = (target: EventTarget | null): number => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-k]') : null
    return el ? Number(el.dataset.k) : -1
  }
  const fine = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const coarse = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches

  if (!drawn) {
    return (
      <figure className="bfly is-empty" aria-label={`No ${scope} pools are scored yet`}>
        <span className="bfly-spine" />
      </figure>
    )
  }

  const lensed = lens >= 0 ? m.rows[lens] : undefined
  const axis = axisTicks(m.ticks, m.max, track)
  const cls = `bfly${grow ? ' grow' : ''}${lensed ? ' is-lens' : ''}${instant ? ' is-instant' : ''}`
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: the figure groups the row links (§5.9 "Accessibility") */}
      <figure
        ref={figRef}
        className={cls}
        role="group"
        aria-label={butterflyLabel(m, scope)}
        onBlur={(e) => {
          if (!figRef.current?.contains(e.relatedTarget as Node | null)) set(-1, 'instant')
        }}
      >
        <div className="bfly-head" aria-hidden="true">
          <span className="lh-sell">
            <span className="sw sell" />
            <span className="lh-long">Sell side, price down</span>
            <span className="lh-short">Sell side</span>
          </span>
          <span className="lh-mid">Depth within 2{NB}%</span>
          <span className="lh-buy">
            <span className="sw buy" />
            <span className="lh-long">Buy side, price up</span>
            <span className="lh-short">Buy side</span>
          </span>
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the tap path of coarse pointers; keyboard focus on a row's link lenses it */}
        <ol
          className="bfly-rows"
          onPointerOver={(e) => {
            if (e.pointerType === 'mouse' && fine()) {
              // A short-leader Gap marker steps back while its row is lensed (its value label takes
              // the lane): pointing at the marker ends the lens, so the word is there to click.
              if ((e.target as Element).closest('.bf-gap.is-tight')) return set(-1, 'pointer')
              const k = rowOf(e.target)
              if (k >= 0) set(k, 'pointer')
            }
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') set(-1, 'pointer')
          }}
          onFocus={(e) => {
            const k = rowOf(e.target)
            if (k >= 0) set(k, 'instant')
          }}
          onClick={(e) => {
            if (!coarse() || (e.target as Element).closest('a')) return
            const k = rowOf(e.target)
            set(k >= 0 && k !== cur.current ? k : -1, 'pointer')
          }}
        >
          {m.rows.map((r, i) => {
            const isGap = gap !== null && gap.poolId === r.id
            return (
              <li
                key={r.id}
                className={`bfly-row${i === lens ? ' is-on' : ''}`}
                data-k={i}
                style={vars({ '--i': i })}
              >
                <span className="bf-side sell">
                  <span className="bf-track">
                    <span
                      className={`bf-bar${r.sell ? '' : ' is-zero'}`}
                      style={vars({ '--w': r.sellW })}
                    />
                    <span className="bf-val" style={vars({ '--w': r.sellW })}>
                      {usd(r.sell)}
                    </span>
                  </span>
                </span>
                <span className="bf-label">
                  <Link className="bf-pair" to={poolHref(r.id)} aria-label={rowLinkLabel(r, scope)}>
                    {r.pair}
                  </Link>
                  <span className="bf-dex">{r.dexShort}</span>
                </span>
                <span className="bf-side buy">
                  <span className="bf-track">
                    <span
                      className={`bf-bar${r.buy ? '' : ' is-zero'}`}
                      style={vars({ '--w': r.buyW })}
                    />
                    <span className="bf-val" style={vars({ '--w': r.buyW })}>
                      {usd(r.buy)}
                    </span>
                    {isGap ? (
                      // The dotted leader is drawn by the marker, not the link, so a tap on the
                      // bars beside it lenses the row instead of following the link.
                      <span
                        className={`bf-gap${gapMarkerTight(r.buyW) ? ' is-tight' : ''}`}
                        style={{ left: `calc(${r.buyW} * 100% + 8px)` }}
                      >
                        <Link
                          className="bf-gap-link touch-hit"
                          to="/gaps"
                          aria-label={`Liquidity gap: ${r.pair} trades ${ratio(gap.turnoverRatio)} its depth a day`}
                        >
                          Gap
                        </Link>
                      </span>
                    ) : null}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
        <div className="bf-total" style={vars({ '--i': Math.min(m.rows.length, 5) })}>
          <TotalSide
            side="sell"
            value={m.total.sell}
            strata={m.strata.sell}
            width={m.total.sell / m.max}
            track={track}
            lens={lensed ? (m.strata.sell[lens] ?? null) : null}
            lensRef={(el) => {
              lensEls.current.sell = el
            }}
          />
          <span className="bf-label">
            <span className="bf-pair tot-name">All of {scope}</span>
            <span className="bf-dex tot-cap-l" aria-live="polite">
              {lensed
                ? `this pool: ${shareOf(lensed.share)}`
                : `${m.poolCount} ${m.poolCount === 1 ? 'pool' : 'pools'}`}
            </span>
          </span>
          <TotalSide
            side="buy"
            value={m.total.buy}
            strata={m.strata.buy}
            width={m.total.buy / m.max}
            track={track}
            lens={lensed ? (m.strata.buy[lens] ?? null) : null}
            lensRef={(el) => {
              lensEls.current.buy = el
            }}
          />
        </div>
        <div className="bfly-axis" aria-hidden="true">
          <span className="ax sell">
            {axis.map((v) => (
              <span key={v} className="tk" style={{ left: `${(1 - v / m.max) * 100}%` }}>
                {usdTick(v)}
              </span>
            ))}
          </span>
          <span className="ax-mid">One scale for every pool</span>
          <span className="ax buy">
            {axis.map((v) => (
              <span key={v} className="tk" style={{ left: `${(v / m.max) * 100}%` }}>
                {usdTick(v)}
              </span>
            ))}
          </span>
        </div>
        {more ? <div className="bfly-more">{more}</div> : null}
      </figure>
      <ShowData className="bfly-foot">{children}</ShowData>
    </>
  )
}
