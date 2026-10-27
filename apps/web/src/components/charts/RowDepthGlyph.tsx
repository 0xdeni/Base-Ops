/**
 * The row depth glyph (CH8, docs/design/visual-v3.md §5.9): an 80 × 20 butterfly for table rows,
 * on the table's shared scale (`max`, the largest side of any row). Sell left of x 40, buy right,
 * 6 px high at y 7, each `max(1, v / max × 38)` wide when non-zero; a 1 × 12 `border` spine. It is
 * decorative (`aria-hidden`): the row's depth value sits beside it.
 */
import './glyphs.css'

/** A side's width in px; 0 for an unknown or zero side, at least 1 otherwise. */
export function glyphWidth(v: number | null, max: number): number {
  if (v === null || !(v > 0) || !(max > 0)) return 0
  return Math.max(1, Math.min(1, v / max) * 38)
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
  const ws = glyphWidth(sell, max)
  const wb = glyphWidth(buy, max)
  return (
    <svg className="glyph" viewBox="0 0 80 20" width={80} height={20} aria-hidden="true">
      <rect x={(40 - ws).toFixed(2)} y={7} width={ws.toFixed(2)} height={6} className="g-sell" />
      <rect x={40} y={7} width={wb.toFixed(2)} height={6} className="g-buy" />
      <rect x={39.5} y={4} width={1} height={12} className="g-spine" />
    </svg>
  )
}
