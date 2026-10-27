/**
 * A section (D4, docs/design/visual-v3.md §5.7): one heading that names the question, one takeaway,
 * one visual and an optional Details disclosure. The Details trigger sits in the heading (K10):
 * under the takeaway in the left column on desktop, at the right end of the heading line on
 * phones; its panel opens under the visual. The head is sticky beside long visuals from 840 px.
 */
import type { ReactNode } from 'react'
import { Disclosure, DisclosurePanel, DisclosureTrigger, useDisclosure } from './Disclosure.js'

export interface SectionDetails {
  /** "Details" by default; "Show samples", "Show measured spread", "Show code", … */
  label?: string
  openLabel?: string
  content: ReactNode
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
  title: ReactNode
  /** One sentence of at most 15 words (P8). */
  takeaway?: ReactNode
  details?: SectionDetails
  /** Further controls after Details in the heading row (a window control, a link). */
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
 * About and Mandate lists (L3, §5.7): a two-column definition list on desktop; on phones the
 * heading is visually hidden and the disclosure ("About this pool") is the section.
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
    <section className="sec is-about" aria-labelledby={id}>
      <div className="sec-head">
        <h2 className="h2" id={id}>
          {title}
        </h2>
      </div>
      <div className="sec-body">
        <Disclosure label={disclosureLabel ?? title} phoneOnly>
          {children}
        </Disclosure>
      </div>
    </section>
  )
}
