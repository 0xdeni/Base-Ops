/**
 * The ranked gap rows, the focal element of `/gaps` (ia-v3 §4.4, docs/design/visual-v3.md §6.4).
 *
 * Each row is `2rem minmax(0, 1fr) auto 136px`: the rank in `text-3`, the pool cell (its link
 * stretched over the row, one tab stop), "Trades 51× its depth a day" and the turnover glyph, the
 * gap score on its log scale with the 3× tick. Volume and depth show as "$1.60M traded through
 * $31.5K of depth" in a tooltip after 600 ms of hover (instantly within 400 ms of the last one,
 * 140 ms in, 0 ms out) or at once when the row's link takes focus; the link's name carries the same
 * words, and the table view holds both columns (K7). Rows under 3× sit behind one quiet disclosure
 * that expands in place. On phones a row is the pool cell, "51×" and the score.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GapItem } from '../../api/types.js'
import { TurnoverGlyph } from '../../components/charts/TurnoverGlyph.js'
import { Disclosure } from '../../components/ui/Disclosure.js'
import { placeTooltip } from '../../components/ui/Glossary.js'
import { PoolCell } from '../../components/ui/Table.js'
import { pairLabel, poolDesc, ratio } from '../../lib/format.js'
import { animate, DUR, EASE, prefersReducedMotion } from '../../lib/motion.js'
import {
  isMeaningful,
  quietLabel,
  quietShortLabel,
  tradesDetail,
  tradesSentence,
} from './gapsModel.js'

/** Shared by every row: the warm window after a tooltip closes, and the one open tooltip. */
const group = { warmUntil: 0, close: null as (() => void) | null }

function GapRow({ g, rank, quiet = false }: { g: GapItem; rank: number; quiet?: boolean }) {
  const id = useId()
  const [tip, setTip] = useState<null | 'animate' | 'instant'>(null)
  const sayRef = useRef<HTMLSpanElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setTip((cur) => {
      if (cur) group.warmUntil = performance.now() + DUR.tooltipWarm
      return null
    })
  }, [])
  const show = useCallback(
    (how: 'animate' | 'instant') => {
      if (group.close && group.close !== hide) group.close()
      group.close = hide
      setTip(how)
    },
    [hide],
  )

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      if (group.close === hide) group.close = null
    },
    [hide],
  )

  useEffect(() => {
    if (!tip) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tip, hide])

  useLayoutEffect(() => {
    const el = tipRef.current
    const say = sayRef.current
    if (!tip || !el) return
    const anchor = say && say.offsetWidth > 0 ? say : rowRef.current
    if (!anchor) return
    const p = placeTooltip(
      anchor.getBoundingClientRect(),
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
    )
    el.style.left = `${p.left}px`
    el.style.top = `${p.top}px`
    el.style.transformOrigin = p.below ? 'center top' : 'center bottom'
    if (tip === 'animate')
      animate(
        el,
        prefersReducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.97)' },
              { opacity: 1, transform: 'none' },
            ],
        { duration: DUR.tooltip, easing: EASE.out },
      )
  }, [tip])

  const leaving = (to: EventTarget | null) => {
    const node = to instanceof Node ? to : null
    return !(rowRef.current?.contains(node) || tipRef.current?.contains(node))
  }
  const pair = pairLabel(g.pool.pool.token0, g.pool.pool.token1)
  const sentence = tradesSentence(g)
  const detail = tradesDetail(g)
  return (
    <li>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only reveal a tooltip that repeats the link's own name (K7); the link is the row's one control */}
      <div
        ref={rowRef}
        className={`rl-row lists-gap-row${quiet ? ' is-quiet' : ''}`}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse' || tip) return
          const warm = performance.now() < group.warmUntil
          clearTimeout(timer.current)
          timer.current = setTimeout(
            () => show(warm ? 'instant' : 'animate'),
            warm ? 0 : DUR.tooltipDelay,
          )
        }}
        onPointerLeave={(e) => {
          clearTimeout(timer.current)
          if (leaving(e.relatedTarget)) hide()
        }}
        onFocus={(e) => {
          if ((e.target as Element).classList.contains('rl-link')) show('instant')
        }}
        onBlur={(e) => {
          if (leaving(e.relatedTarget)) hide()
        }}
      >
        <span className="lists-rank num">{rank}</span>
        <PoolCell
          pool={g.pool.pool}
          label={`${pair}, ${poolDesc(g.pool.pool)}. ${sentence}: ${detail}.`}
        />
        <span ref={sayRef} className="lists-gap-say">
          {sentence}
        </span>
        <span className="lists-gap-ratio num" aria-hidden="true">
          {ratio(g.gap.turnoverRatio)}
        </span>
        <TurnoverGlyph gapScore={g.gap.gapScore} quiet={quiet} />
      </div>
      {tip && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              className="tip"
              role="tooltip"
              onPointerLeave={(e) => {
                if (leaving(e.relatedTarget)) hide()
              }}
            >
              {detail}
            </div>,
            document.body,
          )
        : null}
    </li>
  )
}

export function GapRows({ items }: { items: readonly GapItem[] }) {
  const real = items.filter(isMeaningful)
  const rest = items.filter((g) => !isMeaningful(g))
  return (
    <>
      {real.length ? (
        <ol className="rowlist lists-gap-list" aria-label="Liquidity gaps">
          {real.map((g, i) => (
            <GapRow key={g.pool.pool.id} g={g} rank={i + 1} />
          ))}
        </ol>
      ) : (
        <p className="lists-gap-none">Every pool trades less than 3× its depth.</p>
      )}
      {rest.length ? (
        <Disclosure
          label={quietLabel(rest.length)}
          phoneLabel={quietShortLabel(rest.length)}
          openLabel="Hide pools under 3×"
          className="lists-gaps-more"
        >
          <ol className="rowlist" aria-label="Pools under 3× turnover">
            {rest.map((g, i) => (
              <GapRow key={g.pool.pool.id} g={g} rank={real.length + i + 1} quiet />
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </>
  )
}
