/**
 * The square field on the Pools band (docs/design/visual-v4.md §5.9.2): "Where Base's depth
 * sits", one rounded square per pool with depth, its area true to that depth, packed largest
 * first from the bottom left. Rated pools are solid white, unrated ones outlined, the smallest
 * share one hatched square of their total; pools with no depth are counted in the caption.
 *
 * A mouse reads the square under it and a click opens the pool; on touch the first tap reads and
 * the second opens. The field is one focusable group: arrow keys step through the rated pools by
 * depth, Enter opens, Escape clears. While a filter is set, squares outside it dim to 0.22.
 *
 * Every square's readout, "Open pool" included, sits hidden in the readout's own grid cell, so the
 * readout always holds the height of the tallest one and reading a square never moves the caption,
 * the controls or the table under it.
 */
import { type CSSProperties, memo, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PoolSummary } from '../../api/types.js'
import { count, NB, pairLabel, poolHref, share, shareOf, usd } from '../../lib/format.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { GradeGlyph } from '../ui/GradeGlyph.js'
import { venueOf } from './butterflyModel.js'
import { type FieldSquare, squareAt, squareField, step, stepOrder } from './squareFieldModel.js'
import { useChartWidth } from './useChartWidth.js'
import './charts.css'
import './field.css'

type Pool = PoolSummary & { id: string; depth: number | null }

export interface SquareFieldProps {
  /** Every scored pool: the field draws those with depth and counts the rest. */
  pools: readonly PoolSummary[]
  /**
   * The table's current filter (a DEX, a search, "Rated only"); squares outside it, and the
   * merged square, dim to 0.22 so the field and the table agree. Null when nothing is set.
   */
  inFilter?: ((pool: PoolSummary) => boolean) | null
  /** "Base". */
  scope?: string
}

export const FIELD_HEIGHT = { desktop: 420, phone: 260 } as const
export const FIELD_MIN_SIDE = { desktop: 5, phone: 4 } as const

/** The pair label inside a square: from 110 px the pair, from 150 px the venue too. */
function SquareLabel({
  q,
  largest,
  total,
  scope,
}: {
  q: FieldSquare<Pool>
  largest: boolean
  total: number
  scope: string
}) {
  if (q.kind !== 'pool' || q.s < 110) return null
  const size = q.s >= 200 ? 24 : q.s >= 150 ? 18 : 14
  return (
    <span className="lab">
      <b style={{ fontSize: `${size}px` }}>{pairLabel(q.pool.pool.token0, q.pool.pool.token1)}</b>
      {q.s >= 150 ? <span>{venueOf(q.pool)}</span> : null}
      {largest && q.s >= 150 ? (
        <>
          <span className="v" style={{ fontSize: `${Math.round(q.s * 0.15)}px` }}>
            {share(q.depth / total)}
          </span>
          <span>
            of {scope}’s depth within 2{NB}%
          </span>
        </>
      ) : null}
    </span>
  )
}

const Square = memo(function Square({
  q,
  i,
  hot,
  dim,
  largest,
  total,
  scope,
}: {
  q: FieldSquare<Pool>
  i: number
  hot: boolean
  dim: boolean
  largest: boolean
  total: number
  scope: string
}) {
  // Placed by an inline transform, which the first view keeps while it scales the square.
  const style = {
    transform: `translate(${q.x.toFixed(2)}px, ${q.y.toFixed(2)}px)`,
    '--s': `${q.s.toFixed(2)}px`,
    '--r': `${Math.max(1, q.s * 0.16).toFixed(2)}px`,
  } as CSSProperties
  const cls = `sq${q.kind === 'merged' ? ' merged' : q.pool.health.rated ? '' : ' unrated'}${hot ? ' hot' : ''}${dim ? ' dim' : ''}`
  if (q.kind === 'merged') return <div className={cls} data-i={i} data-sq="" style={style} />
  return (
    <Link
      className={cls}
      data-i={i}
      data-sq=""
      to={poolHref(q.pool.pool.id)}
      tabIndex={-1}
      style={style}
    >
      <SquareLabel q={q} largest={largest} total={total} scope={scope} />
    </Link>
  )
})

function Readout({
  q,
  total,
  scope,
  touch,
  ghost = false,
}: {
  q: FieldSquare<Pool> | undefined
  total: number
  scope: string
  touch: boolean
  /** A hidden copy that only holds the readout's height: "Open pool" is plain text. */
  ghost?: boolean
}) {
  if (!q) return <span className="t2">Point at, focus or tap a square to read its pool.</span>
  if (q.kind === 'merged')
    return (
      <>
        <b className="who">{count(q.pools.length)} smallest pools</b>
        <span className="depth">
          {usd(q.depth)} within 2{NB}% together, {shareOf(q.depth / total)} of {scope}
        </span>
      </>
    )
  const p = q.pool
  return (
    <>
      <b className="who">
        {pairLabel(p.pool.token0, p.pool.token1)}, {venueOf(p)}
      </b>
      <span className="depth">
        {usd(q.depth)} within 2{NB}%: {usd(p.depth2DownUsd)} sell, {usd(p.depth2UpUsd)} buy
      </span>
      <span>
        {shareOf(q.depth / total)} of {scope}
      </span>
      {p.health.rated && p.health.grade ? (
        <GradeGlyph grade={p.health.grade} />
      ) : (
        <span className="t2">Not rated</span>
      )}
      {ghost ? (
        <span className="lens-open">Open pool</span>
      ) : touch ? (
        <Link className="lens-open" to={poolHref(p.pool.id)}>
          Open pool
        </Link>
      ) : null}
    </>
  )
}

export function SquareField({ pools, inFilter = null, scope = 'Base' }: SquareFieldProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const W = useChartWidth(fieldRef)
  const phone = useIsPhone()
  const H = phone ? FIELD_HEIGHT.phone : FIELD_HEIGHT.desktop
  const min = phone ? FIELD_MIN_SIDE.phone : FIELD_MIN_SIDE.desktop
  const pointer = useRef('mouse')
  const [hot, setHot] = useState(-1)
  const [touch, setTouch] = useState(false)
  const m = useMemo(
    () =>
      squareField<Pool>(
        pools.map((p) => ({ ...p, id: p.pool.id, depth: p.depth2Usd })),
        W,
        H,
        { min },
      ),
    [pools, W, H, min],
  )
  const order = useMemo(() => stepOrder(m.squares, (p) => p.health.rated), [m])
  const ghosts = useMemo(
    () =>
      m.squares.map((q) => (
        <p
          key={q.kind === 'pool' ? q.pool.pool.id : 'merged'}
          className="lens is-ghost"
          aria-hidden="true"
        >
          <Readout q={q} total={m.total} scope={scope} touch ghost />
        </p>
      )),
    [m, scope],
  )
  const cur = hot >= 0 ? m.squares[hot] : undefined
  const at = (e: { clientX: number; clientY: number }) => {
    const r = fieldRef.current?.getBoundingClientRect()
    return r ? squareAt(m.squares, e.clientX - r.left, e.clientY - r.top) : -1
  }
  const read = (i: number, viaTouch: boolean) => {
    setHot(i)
    setTouch(viaTouch)
  }
  const open = (i: number) => {
    const el = fieldRef.current?.querySelector<HTMLElement>(`a.sq[data-i="${i}"]`)
    // A script click has `detail` 0: the route change is instant and focus moves to <main>.
    el?.click()
  }

  const merged = m.merged
  const label = `Where ${scope}’s depth sits: one square per pool, area proportional to its depth within 2${NB}% of the price. Arrow keys step through the rated pools, Enter opens one.`
  return (
    <figure className="field-wrap" data-chart="">
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable group of squares, not a set of form controls (§5.9.2) */}
      <div
        ref={fieldRef}
        className="field"
        role="group"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: one focusable group stepped by the arrow keys (§5.9.2)
        tabIndex={0}
        aria-roledescription="square field"
        aria-label={label}
        style={{ height: `${H}px` }}
        onPointerDown={(e) => {
          pointer.current = e.pointerType
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return
          const i = at(e)
          // Over a gutter the last square stays read, so the readout does not flicker.
          if (i >= 0 && i !== hot) read(i, false)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') read(-1, false)
        }}
        onClick={(e) => {
          if ((e.target as Element).closest?.('a')) return
          // On touch a square's link takes taps only once it is read (field.css), so a first
          // tap lands here; the merged square only reads.
          const i = at(e)
          if (i >= 0) read(i, pointer.current !== 'mouse')
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') read(step(order, hot, 1), false)
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') read(step(order, hot, -1), false)
          else if (e.key === 'Enter' && cur?.kind === 'pool') open(hot)
          else if (e.key === 'Escape') read(-1, false)
          else return
          e.preventDefault()
        }}
      >
        <div className="field-sqs" aria-hidden="true">
          {m.squares.map((q, i) => (
            <Square
              key={q.kind === 'pool' ? q.pool.pool.id : 'merged'}
              q={q}
              i={i}
              hot={i === hot}
              dim={inFilter !== null && (q.kind === 'merged' || !inFilter(q.pool))}
              largest={i === 0}
              total={m.total}
              scope={scope}
            />
          ))}
        </div>
      </div>
      <div className="lens-box" data-furniture="">
        <p className="lens" aria-live="polite">
          <Readout q={cur} total={m.total} scope={scope} touch={touch} />
        </p>
        {ghosts}
      </div>
      <figcaption className="field-cap" data-furniture="">
        Where {scope}’s depth sits: one square per pool, its area true to the pool’s depth within 2
        {NB}% of the price. Solid: rated A to F. Outlined: not rated.
        {merged ? (
          <>
            {' '}
            <span className="hatch" aria-hidden="true" />
            The {count(merged.count)} smallest, each under {usd(merged.max)}, are drawn as one
            square of their total, {usd(merged.depth)}.
          </>
        ) : null}
        {m.zero ? (
          <>
            {' '}
            The {count(m.zero)} {m.zero === 1 ? 'pool that holds' : 'pools that hold'} no depth
            within 2{NB}% {m.zero === 1 ? 'is' : 'are'} not drawn.
          </>
        ) : null}
      </figcaption>
    </figure>
  )
}
