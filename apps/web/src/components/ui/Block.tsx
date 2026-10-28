/**
 * Blocks (docs/design/visual-v4.md §5.2, §3.7): the rounded square (radius 18) that holds a
 * page's content, padded 24 (32 from 600 px).
 * - `plain` (plane 1): `--surface`, its edge, `--sh-1` and the top highlight;
 * - `ink`: Gray 100 in both themes, with a Gray 80 edge in dark, Yellow focus rings;
 * - `panel`: `--surface-2` with no shadow (the canvas plus its edge in dark), for reference lists;
 * - `over`: stacked over the band's lower edge (plane 2, `--sh-band`), inside an `Overlap`; the
 *   ink block always sits on plane 2. It rises with the first view (`data-over`).
 * `flush` drops the padding and clips the block to its radius (the table and sections sheets).
 * A block with `to` is a single destination: the whole block is one link, its hover fades in a
 * plane-2 shadow layer and its press scales 0.985. A block with several links never takes `to`,
 * and a block never holds another block.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type BlockVariant = 'plain' | 'ink' | 'panel'
export type BlockSpan = 3 | 4 | 5 | 6 | 7 | 8 | 12

export interface BlockProps {
  variant?: BlockVariant
  /** Stacked over the band (plane 2). */
  over?: boolean
  /** No padding, clipped to the radius: a sheet of rows. */
  flush?: boolean
  /** The columns it spans in a `.grid` from 840 px. */
  span?: BlockSpan
  /** A single destination: the whole block links here. */
  to?: string
  /** The link's accessible name when the block's text is not enough. */
  linkLabel?: string
  /** Rendered as this element when it is not a link ("section", "article", "aside"). */
  as?: 'div' | 'section' | 'article' | 'aside'
  /** The id of the heading that names it (a `section`). */
  labelledBy?: string
  className?: string
  children: ReactNode
}

/** The class list of a block: shared by the component and the pages that render one by hand. */
export function blockClass({
  variant = 'plain',
  over = false,
  flush = false,
  span,
  dest = false,
  className,
}: Pick<BlockProps, 'variant' | 'over' | 'flush' | 'span' | 'className'> & {
  dest?: boolean
}): string {
  return [
    'blk',
    variant === 'ink' ? 'ink' : null,
    variant === 'panel' ? 'blk--panel' : null,
    over ? 'blk--over' : null,
    flush ? 'blk--flush' : null,
    span ? `c${span}` : null,
    dest ? 'is-dest' : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(' ')
}

export function Block({
  variant = 'plain',
  over = false,
  flush = false,
  span,
  to,
  linkLabel,
  as: Tag = 'div',
  labelledBy,
  className,
  children,
}: BlockProps) {
  const cls = blockClass({ variant, over, flush, span, dest: to !== undefined, className })
  const rise = over ? { 'data-over': '' } : {}
  if (to !== undefined) {
    return (
      <Link className={cls} to={to} aria-label={linkLabel} {...rise}>
        {children}
      </Link>
    )
  }
  return (
    <Tag className={cls} aria-labelledby={labelledBy} {...rise}>
      {children}
    </Tag>
  )
}

/**
 * The row that stacks blocks over the band's lower edge: `margin-top` minus the overlap (48, 64
 * from 600 px, 72 from 1200), above the band. With `grid` its blocks sit on the 12-column grid.
 */
export function Overlap({
  grid = false,
  label,
  className,
  children,
}: {
  grid?: boolean
  /** The region's accessible name, when it is a landmark of its own. */
  label?: string
  className?: string
  children: ReactNode
}) {
  const cls = `wrap overlap${className ? ` ${className}` : ''}`
  return (
    <section className={cls} aria-label={label}>
      {grid ? <div className="grid">{children}</div> : children}
    </section>
  )
}
