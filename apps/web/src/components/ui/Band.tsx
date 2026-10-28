/**
 * The band (docs/design/visual-v4.md §5.2): full bleed, flat Base Blue, white text; secondary text
 * white at 80 % and focus rings Yellow. The ground is its own layer (`.band-ground`) so the first
 * view can clip it without moving the content. The bottom padding is the overlap plus 24, so the
 * first block can stack over its lower edge (`Overlap`); a band with nothing over it is `closed`.
 * Every page but Not found opens on one, or reaches one directly under its title section.
 */
import type { ReactNode } from 'react'

export function Band({
  label,
  labelledBy,
  eyebrow,
  hero = false,
  closed = false,
  className,
  children,
}: {
  /** The region's accessible name when no heading inside names it ("What a gap is"). */
  label?: string
  /** The id of the heading that names the region. */
  labelledBy?: string
  /** The one-line mono caps metadata at the top of the band. */
  eyebrow?: ReactNode
  /** Home's hero band: 24 px top padding instead of 32. */
  hero?: boolean
  /** No block stacks over its lower edge: the bottom padding is 32, not the overlap. */
  closed?: boolean
  className?: string
  children: ReactNode
}) {
  const cls = `band${hero ? ' is-hero' : ''}${closed ? ' is-closed' : ''}${className ? ` ${className}` : ''}`
  return (
    <section className={cls} aria-label={label} aria-labelledby={labelledBy}>
      <div className="band-ground" aria-hidden="true" />
      <div className="wrap">
        {eyebrow ? (
          <p className="eyebrow eb-row" data-in>
            {eyebrow}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  )
}
