/**
 * The logo (K11, docs/design/visual-v3.md §5.13): a 2 × 14 text-1 spine with three steps on each
 * side in the side colours, the only multicolour glyph, plus the 16 / 600 wordmark.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="mark"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="m-spine" x="7" y="1" width="2" height="14" rx=".5" />
      <path className="m-sell" d="M4 3h2v2H4zM2 7h4v2H2zM0 11h6v2H0z" />
      <path className="m-buy" d="M10 3h2v2h-2zM10 7h4v2h-4zM10 11h6v2h-6z" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <>
      <Mark />
      <span className="wordmark">Depthwatch</span>
    </>
  )
}
