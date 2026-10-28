/**
 * The phone sheet (docs/design/visual-v4.md §5.10, §4.4): Filter pools and Sort pools. Fixed to
 * the bottom, radius 24 at the top, a 44 × 5 grip in a 28 px drag area, a 24 px / 800 title,
 * options of at least 52 px with a check on the selected one, and a full-width primary "Done".
 * In from `translateY(100%)` over 500 ms `--ease-drawer` with the scrim over 300 ms; out over
 * 260 ms `--ease-out`; a 200 ms fade under reduced motion; instant when opened from the keyboard.
 * Focus is trapped and returned, Escape and the scrim close it, the body cannot scroll behind it,
 * and it drags down to dismiss (faster than 0.4 px/ms or past 25 % of its height; otherwise it
 * snaps back over 300 ms). It unmounts with its page, so a route change closes it.
 */
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { animate, DUR, EASE, prefersReducedMotion } from '../../lib/motion.js'
import { Button } from './Button.js'
import { Icon } from './Icon.js'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface SheetProps {
  open: boolean
  /** Asks the owner to close (Done, backdrop, Escape, drag); the owner sets `open` false. */
  onClose: () => void
  title: string
  children: ReactNode
  /** Below the options, above "Done": the Sort sheet's "Highest first / Lowest first" control. */
  foot?: ReactNode
  /** Opened or closed from the keyboard: no motion (M2). */
  instant?: boolean
}

export function Sheet({ open, onClose, title, children, foot, instant = false }: SheetProps) {
  const titleId = useId()
  const [mounted, setMounted] = useState(open)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const backRef = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const dragFrom = useRef(0)
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null)

  if (open && !mounted) setMounted(true)

  // Enter: remember where focus was, lock the body, animate, focus the selected option.
  useLayoutEffect(() => {
    if (!open || !mounted) return
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const sheet = sheetRef.current
    if (sheet && !instant) {
      if (prefersReducedMotion()) {
        const fade = { duration: DUR.fade, easing: 'linear' }
        animate(sheet, [{ opacity: 0 }, { opacity: 1 }], fade)
        animate(backRef.current, [{ opacity: 0 }, { opacity: 1 }], fade)
      } else {
        animate(sheet, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], {
          duration: DUR.sheet,
          easing: EASE.drawer,
        })
        animate(backRef.current, [{ opacity: 0 }, { opacity: 1 }], {
          duration: DUR.scrim,
          easing: 'linear',
        })
      }
    }
    const first =
      sheet?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      sheet?.querySelector<HTMLElement>('.sheet-body button')
    ;(first ?? sheet)?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open, mounted, instant])

  // Exit: animate out from wherever a drag left it, then unmount and return focus.
  useEffect(() => {
    if (open || !mounted) return
    const done = () => {
      setMounted(false)
      returnTo.current?.focus({ preventScroll: true })
    }
    const sheet = sheetRef.current
    if (instant || !sheet || prefersReducedMotion()) return done()
    const opts = { duration: DUR.sheetOut, easing: EASE.out, fill: 'forwards' as const }
    const a = animate(
      sheet,
      [{ transform: `translateY(${dragFrom.current}px)` }, { transform: 'translateY(100%)' }],
      opts,
    )
    animate(backRef.current, [{ opacity: 1 }, { opacity: 0 }], opts)
    dragFrom.current = 0
    if (a) a.onfinish = done
    else done()
  }, [open, mounted, instant])

  if (!mounted || typeof document === 'undefined') return null

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => el.tabIndex >= 0,
    )
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 }
    sheetRef.current?.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const sheet = sheetRef.current
    if (!d || !sheet) return
    d.dy = Math.max(0, e.clientY - d.y0)
    sheet.style.transform = `translateY(${d.dy}px)`
  }
  const onPointerUp = () => {
    const d = drag.current
    const sheet = sheetRef.current
    drag.current = null
    if (!d || !sheet) return
    const v = d.dy / Math.max(1, performance.now() - d.t0)
    sheet.style.transform = ''
    if (v > 0.4 || d.dy > sheet.offsetHeight * 0.25) {
      dragFrom.current = d.dy
      onClose()
    } else if (d.dy > 0) {
      animate(sheet, [{ transform: `translateY(${d.dy}px)` }, { transform: 'translateY(0)' }], {
        duration: DUR.scrim,
        easing: EASE.drawer,
      })
    }
  }

  return createPortal(
    <div className="sheet-root">
      <div ref={backRef} className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div
          className="sheet-drag"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="sheet-grip" aria-hidden="true" />
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
        </div>
        <div className="sheet-body">{children}</div>
        {foot ? <div className="sheet-foot">{foot}</div> : null}
        <div className="sheet-done">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export interface SheetOption<T extends string> {
  value: T
  label: ReactNode
  /** A value on the right of the row, before the check ("83 %"). */
  meta?: ReactNode
  /** The option's accessible name when its label and meta are not enough. */
  ariaLabel?: string
}

/**
 * The sheet's option rows (at least 52 px, a check on the selected one) as a radio group: arrow
 * keys move and select, like every other radio group in the product. An option may carry a meta
 * value on its right (a DEX's share of the depth in the Filter sheet).
 */
export function SheetOptions<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<SheetOption<T>>
  value: T
  onChange: (value: T) => void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const n = options.length
    let j = -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (index + 1) % n
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (index - 1 + n) % n
    const next = options[j]
    if (!next) return
    e.preventDefault()
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus()
    onChange(next.value)
  }
  return (
    <div ref={listRef} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        // biome-ignore lint/a11y/useSemanticElements: full-row custom radios with a check icon (PH4)
        <button
          key={o.value}
          type="button"
          role="radio"
          className="opt"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <span>{o.label}</span>
          {o.meta !== undefined ? <span className="opt-meta num">{o.meta}</span> : null}
          <Icon name="check" />
        </button>
      ))}
    </div>
  )
}
