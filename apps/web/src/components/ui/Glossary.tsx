/**
 * Glossary term and tooltip (D8, docs/design/visual-v4.md §5.10, §4.4). The term is an inline
 * button with a dotted underline (focusable, and a tap shows the definition on touch), with a
 * 44 × 44 hit area on a coarse pointer (`touch-hit`, §8.10). The tooltip
 * is Gray 100 with white text (Gray 80 in dark), radius 12, 10 px above its trigger (below when
 * there is no room). It opens after 600 ms of mouse hover (140 ms in from scale(0.97) on the
 * trigger side; opacity only under reduced motion), instantly on focus, and instantly for any term
 * hovered within 400 ms of the last one closing; it closes in 0 ms, is hoverable, and Escape
 * dismisses it. One or two lines, then "How it is measured" linking to the Methodology anchor.
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { animate, DUR, EASE, prefersReducedMotion } from '../../lib/motion.js'

/** Shared across terms: the warm window and the one open tooltip. */
const group = { warmUntil: 0, closeOpen: null as (() => void) | null }

/** Ends the warm window (tests start each case cold). */
export function coolGlossary(): void {
  group.warmUntil = 0
}

/** The tooltip's distance from its trigger (px). */
export const TOOLTIP_GAP = 10

/** Position of a tooltip of size `tw` × `th` centred above `r`, flipped below near the top. */
export function placeTooltip(
  r: { left: number; top: number; bottom: number; width: number },
  tw: number,
  th: number,
  viewport: number,
): { left: number; top: number; below: boolean } {
  let top = r.top - th - TOOLTIP_GAP
  const below = top < 8
  if (below) top = r.bottom + TOOLTIP_GAP
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), viewport - tw - 8)
  return { left, top, below }
}

export function Glossary({
  children,
  definition,
  anchor,
  className,
}: {
  /** The term as it reads in the sentence ("bps", "KPI", "health"). */
  children: ReactNode
  /** One or two lines of plain text. */
  definition: string
  /** The Methodology anchor ("depth", "spread", "health", "gaps", "scorecards", …). */
  anchor?: string
  /** Extra classes for the term. */
  className?: string
}) {
  const id = useId()
  const [open, setOpen] = useState<null | 'animate' | 'instant'>(null)
  const termRef = useRef<HTMLButtonElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openedAt = useRef(0)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setOpen((cur) => {
      if (cur) group.warmUntil = performance.now() + DUR.tooltipWarm
      return null
    })
  }, [])

  const show = useCallback(
    (how: 'animate' | 'instant') => {
      clearTimeout(timer.current)
      if (group.closeOpen && group.closeOpen !== hide) group.closeOpen()
      group.closeOpen = hide
      openedAt.current = performance.now()
      setOpen(how)
    },
    [hide],
  )

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      if (group.closeOpen === hide) group.closeOpen = null
    },
    [hide],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, hide])

  useLayoutEffect(() => {
    const term = termRef.current
    const tip = tipRef.current
    if (!open || !term || !tip) return
    const p = placeTooltip(
      term.getBoundingClientRect(),
      tip.offsetWidth,
      tip.offsetHeight,
      window.innerWidth,
    )
    tip.style.left = `${p.left}px`
    tip.style.top = `${p.top}px`
    tip.style.transformOrigin = p.below ? 'center top' : 'center bottom'
    if (open === 'animate')
      animate(
        tip,
        prefersReducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.97)' },
              { opacity: 1, transform: 'none' },
            ],
        { duration: DUR.tooltip, easing: EASE.out },
      )
  }, [open])

  const leaving = (to: EventTarget | null) => {
    const node = to instanceof Node ? to : null
    return !(termRef.current?.contains(node) || tipRef.current?.contains(node))
  }

  return (
    <>
      <button
        ref={termRef}
        type="button"
        className={`gloss touch-hit${className ? ` ${className}` : ''}`}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          // A tap or click toggles the definition: the touch path to it (K7).
          if (e.detail === 0) return
          // The focus that came with this press already opened it.
          if (open && performance.now() - openedAt.current < 400) return
          if (open) hide()
          else show('instant')
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse' || open) return
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
        onFocus={() => show('instant')}
        onBlur={(e) => {
          if (leaving(e.relatedTarget)) hide()
        }}
      >
        {children}
      </button>
      {open && typeof document !== 'undefined'
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
              {definition}
              {anchor ? (
                <>
                  {' '}
                  <Link className="plink" to={`/methodology#${anchor}`} onClick={hide}>
                    How it is measured
                  </Link>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
