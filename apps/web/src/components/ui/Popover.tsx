/**
 * Popover (docs/design/visual-v3.md §5.10, §4 row 19): a `role="dialog"` layer in a portal outside
 * <main>, 8 px below its trigger, aligned to its nearer edge and 8 px from the viewport edge. In
 * from `translateY(4px) scale(0.97)` over 180 ms, out over 100 ms, origin at the trigger; opacity
 * only under reduced motion; a keyboard open is instant. Closes on an outside pointer-down, on
 * Escape (focus returns to the trigger) and when focus leaves it.
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
import { animate, DUR, EASE, isKeyboardClick, prefersReducedMotion } from '../../lib/motion.js'

export interface PopoverProps {
  /** The dialog's accessible name ("Data freshness"). */
  label: string
  /** The trigger's content. */
  trigger: ReactNode
  /** The trigger's class ("fresh", "quiet-link", "btn quiet"). */
  triggerClassName?: string
  /** The trigger's accessible name when its content is not enough. */
  triggerLabel?: string
  /** Shown on the trigger as a native tooltip (the freshness summary, ia-v3 §3.2). */
  triggerTitle?: string
  children: ReactNode
  className?: string
}

/** Left edge and transform origin for a popover of width `pw` under the trigger rect `r`. */
export function placePopover(
  r: { left: number; right: number; bottom: number; width: number },
  pw: number,
  viewport: number,
): { left: number; top: number; origin: string } {
  let left = Math.min(Math.max(8, r.right - pw), viewport - pw - 8)
  if (r.left + pw < viewport - 8 && r.left < viewport / 2) left = Math.max(8, r.left)
  left = Math.max(8, left)
  return { left, top: r.bottom + 8, origin: `${r.left + r.width / 2 - left}px top` }
}

export function Popover({
  label,
  trigger,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  children,
  className,
}: PopoverProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const enter = useRef<'animate' | 'instant' | null>(null)

  const position = useCallback(() => {
    const t = triggerRef.current
    const pop = popRef.current
    if (!t || !pop) return
    const p = placePopover(t.getBoundingClientRect(), pop.offsetWidth, window.innerWidth)
    pop.style.left = `${p.left}px`
    pop.style.top = `${p.top}px`
    pop.style.transformOrigin = p.origin
  }, [])

  const close = useCallback((instant: boolean, refocus = false) => {
    setOpen(false)
    const pop = popRef.current
    if (refocus) triggerRef.current?.focus()
    if (instant || !pop || prefersReducedMotion()) {
      setMounted(false)
      return
    }
    const a = animate(
      pop,
      [{ opacity: 1 }, { opacity: 0, transform: 'translateY(2px) scale(0.98)' }],
      { duration: DUR.exit, easing: EASE.out },
    )
    if (a) a.onfinish = () => setMounted(false)
    else setMounted(false)
  }, [])

  useLayoutEffect(() => {
    if (!mounted || !open) return
    position()
    const how = enter.current
    enter.current = null
    const pop = popRef.current
    if (!pop || !how) return
    if (how === 'instant') {
      pop.focus({ preventScroll: true })
      return
    }
    animate(
      pop,
      prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translateY(4px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
      { duration: DUR.popover, easing: EASE.out },
    )
  }, [mounted, open, position])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true, true)
    }
    const onMove = () => position()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove)
    }
  }, [open, close, position])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={mounted ? id : undefined}
        aria-label={triggerLabel}
        title={triggerTitle}
        onClick={(e) => {
          const keyboard = isKeyboardClick(e)
          if (open) return close(keyboard)
          for (const a of popRef.current?.getAnimations?.() ?? []) a.cancel()
          enter.current = keyboard ? 'instant' : 'animate'
          setOpen(true)
          setMounted(true)
        }}
      >
        {trigger}
      </button>
      {mounted && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              id={id}
              className={`pop${className ? ` ${className}` : ''}`}
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null
                if (!next) return
                if (popRef.current?.contains(next) || triggerRef.current?.contains(next)) return
                close(true)
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
