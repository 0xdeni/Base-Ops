/**
 * The ranked gap rows, the focal element of `/gaps` (ia-v3 §4.4, docs/design/visual-v4.md §5.8,
 * §6.5), in a block over the band.
 *
 * A row is at least 72 px: the pool cell (its link stretched over the row, one tab stop), the
 * sentence "Trades 205× its depth a day" (15 px / 650) and the turnover glyph with the gap score at
 * 800; on phones the pool cell takes the first line and "205×" and the glyph the second. The rank
 * is the list's own order (an `<ol>`). Volume and depth show as "$3.03M traded through $14.8K of
 * depth" in a tooltip after 600 ms of hover (instantly within 400 ms of the last one, 140 ms in,
 * 0 ms out) or at once when the row's link takes focus; the link's name carries the same words, and
 * the table view holds both columns (K7). The first 20 meaningful gaps show, then "Show all 48"
 * (`rows=all`); once all of them are on screen the rows under 3× wait behind one disclosure.
 */
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { GapItem } from '../../api/types.js'
import { TurnoverGlyph } from '../../components/charts/TurnoverGlyph.js'
import { Button } from '../../components/ui/Button.js'
import {
  DisclosurePanel,
  DisclosureTrigger,
  useDisclosure,
} from '../../components/ui/Disclosure.js'
import { placeTooltip } from '../../components/ui/Glossary.js'
import { PoolCell } from '../../components/ui/Table.js'
import { count, pairLabel, poolDesc, ratio } from '../../lib/format.js'
import { animate, DUR, EASE, isKeyboardClick, prefersReducedMotion } from '../../lib/motion.js'
import {
  GAP_PAGE,
  isMeaningful,
  quietLabel,
  quietShortLabel,
  restSentence,
  tradesDetail,
  tradesSentence,
} from './gapsModel.js'

/** Shared by every row: the warm window after a tooltip closes, and the one open tooltip. */
const group = { warmUntil: 0, close: null as (() => void) | null }

function GapRow({ g, quiet = false }: { g: GapItem; quiet?: boolean }) {
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

export function GapRows({
  items,
  allRows,
  onShowAll,
}: {
  items: readonly GapItem[]
  /** `rows=all`: every meaningful gap, not the first 20. */
  allRows: boolean
  onShowAll: () => void
}) {
  const real = items.filter(isMeaningful)
  const rest = items.filter((g) => !isMeaningful(g))
  const shown = allRows ? real : real.slice(0, GAP_PAGE)
  const held = real.length - shown.length
  const quiet = useDisclosure()
  const listRef = useRef<HTMLOListElement | null>(null)
  // "Show all" from the keyboard hands focus to the first row it revealed.
  const focusRow = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = focusRow.current
    if (at === null || held > 0) return
    focusRow.current = null
    listRef.current?.querySelectorAll<HTMLElement>('.rl-link')[at]?.focus()
  })
  const showAll = (e: MouseEvent) => {
    focusRow.current = isKeyboardClick(e) ? shown.length : null
    onShowAll()
  }
  const quietOffered = held === 0 && rest.length > 0
  return (
    <>
      {real.length ? (
        <ol ref={listRef} className="rowlist is-ruled lists-gap-list" aria-label="Liquidity gaps">
          {shown.map((g) => (
            <GapRow key={g.pool.pool.id} g={g} />
          ))}
        </ol>
      ) : (
        <p className="lists-gap-none">Every pool trades less than 3× its depth.</p>
      )}
      <div className="blk-foot lists-gaps-foot">
        {held > 0 ? <Button onClick={showAll}>Show all {count(real.length)}</Button> : null}
        {quietOffered ? (
          <DisclosureTrigger
            state={quiet}
            label={quietLabel(rest.length)}
            phoneLabel={quietShortLabel(rest.length)}
            openLabel="Hide pools under 3×"
          />
        ) : null}
        <p className="cap">
          {held > 0 && rest.length ? `${restSentence(rest.length)} ` : null}
          Gap score 0–100; the tick marks 3× turnover.
        </p>
      </div>
      {quietOffered ? (
        <DisclosurePanel state={quiet} className="lists-gaps-quiet">
          <ol className="rowlist is-ruled" aria-label="Pools under 3× turnover">
            {rest.map((g) => (
              <GapRow key={g.pool.pool.id} g={g} quiet />
            ))}
          </ol>
        </DisclosurePanel>
      ) : null}
    </>
  )
}
