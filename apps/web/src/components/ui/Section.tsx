/**
 * The sections sheet (docs/design/visual-v4.md §5.7): Pool and Scorecard set their sections as the
 * rows of one plane-1 block (`SectionsSheet`), split by 1 px rules; no block per section and no
 * card grid. A row is the lowercase h2 that names the question, one finding sentence and the
 * Details trigger in the head; the visual in the body, with the Details panel opening under it.
 * From 1024 px the head takes 4 / 12 and the body 8 / 12; below, the trigger sits at the right of
 * the heading's line and the sentence under both. At most one disclosure level (P5).
 *
 * The reference list (About this pool, Mandate) is `AboutSection`: a panel after the sheet, a
 * two-column definition list from 840 px and a disclosure on phones.
 */
import type { ReactNode } from 'react'
import { Disclosure, DisclosurePanel, DisclosureTrigger, useDisclosure } from './Disclosure.js'

export interface SectionDetails {
  /** "Details" by default; "Show samples", "Show code", … */
  label?: string
  openLabel?: string
  content: ReactNode
}

/** The one block that holds a page's sections as rows. */
export function SectionsSheet({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={`secs${className ? ` ${className}` : ''}`}>{children}</div>
}

export function Section({
  id,
  title,
  takeaway,
  details,
  controls,
  className,
  children,
}: {
  /** The heading's id; the section is labelled by it. */
  id: string
  /** Lowercase words that name the question ("cost to trade"). */
  title: ReactNode
  /** One finding sentence of at most 40ch. */
  takeaway?: ReactNode
  details?: SectionDetails
  /** Further controls after Details in the head (a window control, a link). */
  controls?: ReactNode
  className?: string
  /** The visual. */
  children: ReactNode
}) {
  const disc = useDisclosure()
  return (
    <section className={`sec${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <div className="sec-head">
        <h2 className="h2" id={id}>
          {title}
        </h2>
        {takeaway ? <p className="takeaway">{takeaway}</p> : null}
        {details || controls ? (
          <div className="sec-ctl">
            {details ? (
              <DisclosureTrigger
                state={disc}
                label={details.label ?? 'Details'}
                openLabel={details.openLabel}
              />
            ) : null}
            {controls}
          </div>
        ) : null}
      </div>
      <div className="sec-body">
        {children}
        {details ? <DisclosurePanel state={disc}>{details.content}</DisclosurePanel> : null}
      </div>
    </section>
  )
}

/**
 * About and Mandate lists: a panel after the sections sheet with its heading and a two-column
 * definition list from 840 px; on phones the heading is visually hidden and the disclosure
 * ("About this pool") is the section.
 */
export function AboutSection({
  id,
  title,
  disclosureLabel,
  children,
}: {
  id: string
  /** "About this pool", "Mandate". */
  title: string
  /** The phone disclosure's label; defaults to the title. */
  disclosureLabel?: string
  /** The `<dl className="about">` list. */
  children: ReactNode
}) {
  return (
    <section className="blk blk--panel sec-about is-about" aria-labelledby={id}>
      <h2 className="h2" id={id}>
        {title}
      </h2>
      <Disclosure label={disclosureLabel ?? title} phoneOnly>
        {children}
      </Disclosure>
    </section>
  )
}
