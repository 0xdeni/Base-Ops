/**
 * The depth butterfly (CH4, ia-v3 §4.1, docs/design/visual-v4.md §5.9.1): the Home and Token
 * focal, drawn on the band. The head reads the scope and its two side totals; the total row splits
 * each side into the deepest pools and a hatched rest, with a bracket stating the deepest pool's
 * share; then one row per pool, sell side left of the spine and buy side right, all on one scale.
 *
 * The lens: a mouse over a row, keyboard focus on its link or the first tap on touch. The readout
 * names the pool and its share, the totals swap to its two sides, and everything else dims to
 * 0.32 (150 ms; instant from the keyboard). The second tap opens the pool; Up and Down move focus
 * between row links; leaving the plot or blurring the figure restores the totals. Every row's
 * readout, "Open pool" included, sits hidden in the readout's own grid cell, so the line always
 * holds the height of the tallest one and a read never moves the rows under the finger.
 */
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import type { PoolSummary } from '../../api/types.js'
import { count, poolHref, usd, usdTick } from '../../lib/format.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { Axis, Bracket, labelFits, PoolRow, TotalRow } from './ButterflyPlot.js'
import {
  axisTicks,
  type ButterflyModel,
  type ButterflyRow,
  butterflyLabel,
  butterflyModel,
  pickButterflyRows,
  readoutText,
} from './butterflyModel.js'
import { ShowData } from './ShowData.js'
import { useChartWidth } from './useChartWidth.js'
import './charts.css'
import './butterfly.css'
import './butterflyStates.css'

export interface ButterflyGap {
  poolId: string
  turnoverRatio: number
}

/** A row in the readout: "WETH / cbBTC, Uniswap v3 0.3 %: 5 % of Base". */
function Who({ row, scope }: { row: ButterflyRow; scope: string }) {
  const t = readoutText(row, scope)
  return (
    <span>
      <b>{t.who}</b>: {t.share}
    </span>
  )
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
  /** The "Show data" table (CH9). */
  children?: ReactNode
}

/** The side lane outside the bars: room for row labels on desktop, a margin on phones. */
const LANE = { desktop: 56, phone: 8 } as const

interface Lens {
  k: number
  /** Set from the keyboard: the dim is instant. */
  instant: boolean
  /** Set by a tap: the readout offers "Open pool". */
  touch: boolean
}

export function DepthButterfly({
  pools,
  rows: rowsProp,
  gap = null,
  scope = 'Base',
  children,
}: DepthButterflyProps) {
  const rows = rowsProp ?? pickButterflyRows(pools, gap?.poolId)
  const m = butterflyModel(rows, pools)
  const figRef = useRef<HTMLElement | null>(null)
  /** The latest press in the plot: its pointer kind, and when (focus right after it is not a key's). */
  const pointer = useRef({ type: 'mouse', at: Number.NEGATIVE_INFINITY })
  const W = useChartWidth(figRef)
  const phone = useIsPhone()
  const [lens, setLens] = useState<Lens | null>(null)

  // A tap or click outside the figure ends the lens.
  useEffect(() => {
    if (!lens) return
    const outside = (e: globalThis.PointerEvent) => {
      if (!figRef.current?.contains(e.target as Node)) setLens(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [lens])

  if (!(m.max > 0)) {
    return (
      <figure className="bf is-empty" aria-label={`No ${scope} pools are scored yet`}>
        <span className="bf-spine" />
      </figure>
    )
  }

  const lane = phone ? LANE.phone : LANE.desktop
  const track = Math.max(1, W / 2 - lane)
  const kept = axisTicks(m.ticks, m.max, track, usdTick)
  const lensed = lens ? m.rows[lens.k] : undefined
  const rowOf = (target: EventTarget | null): number => {
    const el = target instanceof Element ? target.closest<HTMLElement>('.bf-pools [data-k]') : null
    return el ? Number(el.dataset.k) : -1
  }
  const set = (k: number, how: Omit<Lens, 'k'>) => {
    if (k < 0) setLens(null)
    else if (!lens || lens.k !== k || lens.instant !== how.instant || lens.touch !== how.touch)
      setLens({ k, ...how })
  }

  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const k = rowOf(e.target)
    if (k >= 0) set(k, { instant: false, touch: false })
  }
  const onFocus = (e: FocusEvent) => {
    const t = e.target as Element
    // Keyboard focus lenses at once; the focus a press brings is left to the pointer.
    if (!t.classList.contains('bf-link') || Date.now() - pointer.current.at < 600) return
    set(rowOf(t), { instant: true, touch: false })
  }
  // On a coarse pointer a row's link takes no taps until the row is lensed (butterflyStates.css),
  // so the first tap lands on the row and reads it; the second follows the link.
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest?.('a')) return
    const k = rowOf(e.target)
    if (k >= 0)
      set(lens?.k === k ? -1 : k, { instant: false, touch: pointer.current.type !== 'mouse' })
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const links = [...(figRef.current?.querySelectorAll<HTMLElement>('.bf-pools .bf-link') ?? [])]
    const i = links.indexOf(e.target as HTMLElement)
    if (i < 0) return
    const next = links[i + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  const cls = `bf${lensed ? ' is-lens' : ''}${lens?.instant ? ' is-instant' : ''}`
  const restWord = `The other ${count(m.rest.count)} ${m.rest.count === 1 ? 'pool' : 'pools'}.`
  return (
    // biome-ignore lint/a11y/useSemanticElements: the figure groups the row links under one summary (§5.9)
    <figure
      ref={figRef}
      className={cls}
      data-chart=""
      role="group"
      aria-label={butterflyLabel(m, scope)}
      onBlur={(e) => {
        if (!figRef.current?.contains(e.relatedTarget as Node | null)) setLens(null)
      }}
    >
      <div className="bf-head" data-furniture="">
        <div className="bf-who">
          <p className="bf-read" aria-live="polite">
            {lensed ? (
              <>
                <Who row={lensed} scope={scope} />
                {lens?.touch ? (
                  <Link className="bf-open" to={poolHref(lensed.id)}>
                    Open pool
                  </Link>
                ) : null}
              </>
            ) : (
              `All of ${scope}, every tracked pool`
            )}
          </p>
          {m.rows.map((r) => (
            <p key={r.id} className="bf-read is-ghost" aria-hidden="true">
              <Who row={r} scope={scope} />
              <span className="bf-open">Open pool</span>
            </p>
          ))}
        </div>
        <div className="s">
          <span className="meta">
            <i className="sw sell-band" aria-hidden="true" />
            Sell side<span className="long">, price down</span>
          </span>
          <b className="bf-tot num">{usd(lensed ? lensed.sell : m.total.sell)}</b>
        </div>
        <div className="b">
          <span className="meta">
            <i className="sw buy-band" aria-hidden="true" />
            Buy side<span className="long">, price up</span>
          </span>
          <b className="bf-tot num">{usd(lensed ? lensed.buy : m.total.buy)}</b>
        </div>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the lens follows the pointer; the row links carry the keyboard path */}
      <div
        className="bf-plot"
        onPointerDown={(e) => {
          pointer.current = { type: e.pointerType, at: Date.now() }
        }}
        onPointerOver={onOver}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setLens(null)
        }}
        onFocus={onFocus}
        onClick={onClick}
        onKeyDown={onKey}
      >
        <TotalRow m={m} scope={scope} showLabel={totalLabelFits(m, scope, track, lane)} />
        <Bracket m={m} />
        <ol className="bf-pools">
          {m.rows.map((r, i) => (
            <PoolRow
              key={r.id}
              row={r}
              index={i}
              on={lens?.k === i}
              stacked={!phone && !labelFits(r, track, lane)}
              scope={scope}
              gap={gap !== null && gap.poolId === r.id && !phone ? gap : null}
            />
          ))}
        </ol>
      </div>
      <Axis m={m} kept={kept} />
      <ShowData
        band
        className="bf-foot"
        note={
          <>
            One scale for every pool.
            {m.rest.count ? (
              <>
                {' '}
                <span className="hatch" aria-hidden="true" />
                {restWord}
              </>
            ) : null}
          </>
        }
      >
        {children}
      </ShowData>
    </figure>
  )
}

/** "All of Base" at 17 px / 800 (about 10 px a glyph) fits left of the sell total. */
function totalLabelFits(m: ButterflyModel, scope: string, track: number, lane: number): boolean {
  const need = `All of ${scope}`.length * 10 + 12
  return (1 - Math.min(1, m.total.sell / m.max)) * track + lane >= need
}
