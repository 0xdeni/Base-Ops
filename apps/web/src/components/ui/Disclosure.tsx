/**
 * Disclosure (docs/design/visual-v4.md §5.3, §4.4): a trigger with a 16 px chevron and
 * `aria-expanded`, its panel following in the DOM. Opening by pointer fades the panel in and
 * settles it from `translateY(-8px)` over 200 ms `--ease-out` while the chevron turns 180°; closing
 * is instant. Keyboard toggles are instant, the chevron included; reduced motion keeps the opacity
 * only. A long label wraps instead of widening the page, with the chevron after its last word; a
 * `phoneLabel` replaces it below 840 px. Its open state is never stored in the URL.
 *
 * The trigger and the panel can live apart (a section's Details sits in its head): use
 * `useDisclosure` with `DisclosureTrigger` and `DisclosurePanel`. `Disclosure` keeps them together.
 */
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { animate, DUR, EASE, isKeyboardClick, prefersReducedMotion } from '../../lib/motion.js'
import { Icon } from './Icon.js'

export interface DisclosureState {
  id: string
  open: boolean
  /** The panel is in the layout (open). */
  visible: boolean
  toggle: (e?: MouseEvent) => void
  panelRef: RefObject<HTMLDivElement | null>
}

export function useDisclosure({
  defaultOpen = false,
  onOpenChange,
}: {
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
} = {}): DisclosureState {
  const id = useId()
  const [open, setOpen] = useState(defaultOpen)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // An open by pointer that the next layout effect animates.
  const enter = useRef(false)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!enter.current || !panel) return
    enter.current = false
    for (const a of panel.getAnimations?.() ?? []) a.cancel()
    animate(
      panel,
      prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translateY(-8px)' },
            { opacity: 1, transform: 'none' },
          ],
      { duration: DUR.disclosure, easing: EASE.out },
    )
  })

  const toggle = (e?: MouseEvent) => {
    const next = !open
    enter.current = next && (e ? !isKeyboardClick(e) : false)
    setOpen(next)
    onOpenChange?.(next)
  }

  return { id, open, visible: open, toggle, panelRef }
}

/**
 * A label with the chevron glued to its last word: when a long label wraps, the chevron follows
 * the last word instead of drifting to the container's edge.
 */
function LabelWithChevron({ text, className }: { text: string; className: string }) {
  const at = text.lastIndexOf(' ')
  const head = at < 0 ? '' : text.slice(0, at + 1)
  const last = at < 0 ? text : text.slice(at + 1)
  return (
    <span className={className}>
      {head}
      <span className="disc-tail">
        {last}
        <Icon name="chevDown" className="chev" />
      </span>
    </span>
  )
}

export function DisclosureTrigger({
  state,
  label,
  openLabel,
  phoneLabel,
  className,
}: {
  state: DisclosureState
  /** "Details", "Show data", "Show all 6 episodes", … */
  label: string
  /** The label while open, e.g. "Show fewer"; defaults to `label`. */
  openLabel?: string
  /**
   * A shorter label shown below 840 px ("Show 5 pools under 3×"); the full label stays the
   * accessible name at every width.
   */
  phoneLabel?: string
  className?: string
}) {
  const text = state.open && openLabel ? openLabel : label
  const short = state.open && openLabel ? null : (phoneLabel ?? null)
  return (
    <button
      type="button"
      className={`disc-btn${className ? ` ${className}` : ''}`}
      aria-expanded={state.open}
      aria-controls={state.id}
      aria-label={short ? text : undefined}
      onClick={(e) => {
        // A keyboard toggle is instant (M2): the chevron skips its rotation for two frames.
        if (isKeyboardClick(e)) {
          const btn = e.currentTarget
          btn.setAttribute('data-instant', '')
          requestAnimationFrame(() =>
            requestAnimationFrame(() => btn.removeAttribute('data-instant')),
          )
        }
        state.toggle(e)
      }}
    >
      <LabelWithChevron text={text} className={`disc-label${short ? ' is-long' : ''}`} />
      {short ? <LabelWithChevron text={short} className="disc-label is-short" /> : null}
    </button>
  )
}

export function DisclosurePanel({
  state,
  children,
  keepMounted = false,
  className,
}: {
  state: DisclosureState
  children: ReactNode
  /** Keep the content in the DOM while closed (phone-only lists that are always open on desktop). */
  keepMounted?: boolean
  className?: string
}) {
  return (
    <div
      ref={state.panelRef}
      className={`disc-panel${className ? ` ${className}` : ''}`}
      id={state.id}
      hidden={!state.visible}
    >
      {state.visible || keepMounted ? <div className="disc-inner">{children}</div> : null}
    </div>
  )
}

/**
 * Trigger plus panel in one block. `phoneOnly` makes it the About / Mandate pattern (L3): a
 * disclosure below 840 px, an always-open list with no trigger from 840 px (CSS `.ph-disc`).
 */
export function Disclosure({
  label,
  openLabel,
  phoneLabel,
  children,
  phoneOnly = false,
  defaultOpen = false,
  className,
}: {
  label: string
  openLabel?: string
  /** A shorter label below 840 px; the full label stays the accessible name. */
  phoneLabel?: string
  children: ReactNode
  phoneOnly?: boolean
  defaultOpen?: boolean
  className?: string
}) {
  const state = useDisclosure({ defaultOpen })
  const cls = `${phoneOnly ? 'ph-disc' : 'disc'}${className ? ` ${className}` : ''}`
  return (
    <div className={cls}>
      <DisclosureTrigger
        state={state}
        label={label}
        openLabel={openLabel}
        phoneLabel={phoneLabel}
      />
      <DisclosurePanel state={state} keepMounted={phoneOnly}>
        {children}
      </DisclosurePanel>
    </div>
  )
}
