/**
 * Disclosure (K10, docs/design/visual-v3.md §5.2, §4 row 14): a quiet trigger with a chevron and
 * `aria-expanded`, its panel following in the DOM. Opening animates height and opacity over
 * 200 ms, closing over 150 ms (`--ease-out`, WAAPI); keyboard toggles are instant (M2), the
 * chevron included; reduced motion keeps the opacity only. A long label wraps instead of widening
 * the page, balanced, with the chevron after its last word; a `phoneLabel` replaces it below
 * 840 px. Its open state is never stored in the URL.
 *
 * The trigger and the panel can live apart (a section's Details sits in its heading, K10): use
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

type Pending = { open: boolean; instant: boolean } | null

export interface DisclosureState {
  id: string
  open: boolean
  /** The panel is in the layout: open, or closing with its exit animation. */
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
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const pending = useRef<Pending>(null)

  useLayoutEffect(() => {
    const p = pending.current
    const panel = panelRef.current
    if (!p || !panel) return
    pending.current = null
    for (const a of panel.getAnimations?.() ?? []) a.cancel()
    if (p.instant) {
      if (!p.open) setClosing(false)
      return
    }
    const reduced = prefersReducedMotion()
    if (p.open) {
      const h = panel.scrollHeight
      animate(
        panel,
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { height: '0px', opacity: 0 },
              { height: `${h}px`, opacity: 1 },
            ],
        { duration: DUR.disclosure, easing: EASE.out },
      )
      return
    }
    const h = panel.offsetHeight
    const anim = animate(
      panel,
      reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { height: `${h}px`, opacity: 1 },
            { height: '0px', opacity: 0 },
          ],
      { duration: DUR.disclosureClose, easing: EASE.out },
    )
    if (anim) anim.onfinish = () => setClosing(false)
    else setClosing(false)
  })

  const toggle = (e?: MouseEvent) => {
    const next = !open
    const instant = e ? isKeyboardClick(e) : true
    pending.current = { open: next, instant }
    setOpen(next)
    setClosing(!next && !instant)
    onOpenChange?.(next)
  }

  return { id, open, visible: open || closing, toggle, panelRef }
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
