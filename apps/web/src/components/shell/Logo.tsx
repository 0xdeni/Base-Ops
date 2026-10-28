/**
 * Depthwatch's mark (docs/design/visual-v4.md §2.3, §5.13): a 2 × 14 spine in `currentColor` with
 * three steps on each side, the sell steps Cerulean and the buy steps Yellow with a 0.5 px Gray 100
 * edge in light. 22 px in the app bar, 28 px in the footer. It never sits on a Base Blue square.
 */
export function Mark({ size = 22 }: { size?: number }) {
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

/** The mark and "Depthwatch", 10 px apart (21 px / 850 in the app bar, 28 px in the footer). */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <>
      <Mark size={size} />
      <span className="wordmark">Depthwatch</span>
    </>
  )
}
