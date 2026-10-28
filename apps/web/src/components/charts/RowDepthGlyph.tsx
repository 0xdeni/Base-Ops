/**
 * The row depth glyph (CH8, docs/design/visual-v4.md §5.8): an 84 × 20 butterfly for table rows, on
 * the table's shared scale (`max`, the largest side of any row). A 2 px ink spine at the centre,
 * the sell bar (Cerulean) left of it and the buy bar (Yellow, with its 1 px ink edge in light)
 * right, 12 px high, each `max(2, v / max × 40)` px wide when non-zero. It is decorative
 * (`aria-hidden`): the row's depth value sits beside it.
 */
import './glyphs.css'

/** The longest a side draws, px: half the glyph less the spine. */
export const GLYPH_SIDE_PX = 40

/** A side's width in px; 0 for an unknown or zero side, at least 2 otherwise. */
export function glyphWidth(v: number | null, max: number): number {
  if (v === null || !(v > 0) || !(max > 0)) return 0
  return Math.max(2, Math.min(1, v / max) * GLYPH_SIDE_PX)
}

export function RowDepthGlyph({
  sell,
  buy,
  max,
}: {
  sell: number | null
  buy: number | null
  max: number
}) {
  return (
    <span className="glyph" aria-hidden="true">
      <i className="s" data-bar="" style={{ width: `${glyphWidth(sell, max).toFixed(2)}px` }} />
      <i className="b" data-bar="" style={{ width: `${glyphWidth(buy, max).toFixed(2)}px` }} />
    </span>
  )
}
