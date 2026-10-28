/**
 * Segmented control (docs/design/visual-v4.md §5.4, §4.4): parallel views only (Rating, the
 * history and scorecard windows, List / Table, the sheet's order control). A `--surface-2` track
 * with 3 px padding, 34 px items (44 on touch), 14 px / 700; the selected item is `--text-1` on the
 * canvas with an edge and a small Blue-tinted shadow. On the band (`onBand`, or inside `.band`) the
 * track is white at 14 % and the selected item Blue on white. A `radiogroup` with a roving tab
 * stop; arrow keys, Home and End move the selection instantly. The thumb is one layer clipped to
 * the selected item (`clip-path: inset(0 R 0 L round 9px)`), so both edges travel over 200 ms
 * `--ease-in-out` without radius distortion; keyboard moves and reduced motion are instant.
 */
import { type KeyboardEvent, type ReactNode, useCallback, useLayoutEffect, useRef } from 'react'
import { isKeyboardClick } from '../../lib/motion.js'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string
}

export interface SegmentedControlProps<T extends string> {
  /** The group's accessible name ("Time window"). */
  label: string
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  /** `keyboard` is true for arrow keys, Enter and Space: callers skip their animations (M2). */
  onChange: (value: T, meta: { keyboard: boolean }) => void
  /** Full width with equal items (the phone sheet's order control). */
  full?: boolean
  /** The band variant: a white 14 % track, Blue text on a white thumb. */
  onBand?: boolean
  className?: string
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  full = false,
  onBand = false,
  className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLSpanElement | null>(null)
  // The first placement and keyboard moves never animate.
  const instant = useRef(true)

  const place = useCallback((animated: boolean) => {
    const group = groupRef.current
    const thumb = thumbRef.current
    const cur = group?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!group || !thumb || !cur) return
    if (!animated) group.setAttribute('data-instant', '')
    // The thumb layer is inset by the track's 3 px padding.
    const inner = group.clientWidth - 6
    const l = cur.offsetLeft - 3
    const r = inner - (l + cur.offsetWidth)
    thumb.style.setProperty('--l', `${l}px`)
    thumb.style.setProperty('--r', `${r}px`)
    if (!animated && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => groupRef.current?.removeAttribute('data-instant')),
      )
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place the thumb when the value or the items change
  useLayoutEffect(() => {
    place(!instant.current)
    instant.current = false
  }, [value, options.length, place])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => place(false))
    ro.observe(group)
    return () => ro.disconnect()
  }, [place])

  const select = (next: T, keyboard: boolean) => {
    if (next === value) return
    if (keyboard) instant.current = true
    onChange(next, { keyboard })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = options.length
    let j = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (index + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (index - 1 + n) % n
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = n - 1
    const next = options[j]
    if (!next) return
    e.preventDefault()
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus()
    select(next.value, true)
  }

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  return (
    <div
      ref={groupRef}
      className={`seg${full ? ' is-full' : ''}${onBand ? ' is-band' : ''}${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      <span ref={thumbRef} className="seg-thumb" aria-hidden="true">
        <i />
      </span>
      {options.map((o, i) => (
        // biome-ignore lint/a11y/useSemanticElements: a custom radio, so the clipped thumb can travel between items
        <button
          key={o.value}
          type="button"
          role="radio"
          className="seg-item"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={i === selectedIndex ? 0 : -1}
          onClick={(e) => {
            if (isKeyboardClick(e)) instant.current = true
            select(o.value, isKeyboardClick(e))
          }}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
