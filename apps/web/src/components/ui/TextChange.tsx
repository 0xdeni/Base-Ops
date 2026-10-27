/**
 * Number change (docs/design/visual-v3.md §4 row 12): when a parameter changes (window switch,
 * price flip, filter), only the characters that changed settle in (opacity and
 * `translateY(0.32em)`, 200 ms `--ease-out`; opacity only under reduced motion). Never a count-up
 * (M7). Live values (refetch, freshness, scrubbing) and keyboard changes pass `animate={false}` and
 * swap instantly (M8). The text never breaks across lines.
 */
import { useRef } from 'react'

export function TextChange({
  value,
  animate = true,
  className,
}: {
  value: string
  /** False for live values and keyboard-initiated changes: an instant swap. */
  animate?: boolean
  className?: string
}) {
  // The last change, kept so re-renders mid-animation keep the same spans (and their animation).
  const last = useRef({ from: value, to: value, gen: 0 })
  if (last.current.to !== value) {
    last.current = { from: last.current.to, to: value, gen: last.current.gen + 1 }
  }
  const { from, gen } = last.current
  const cls = `roll${className ? ` ${className}` : ''}`
  if (!animate || gen === 0 || from === value) {
    return <span className={cls}>{value}</span>
  }
  const a = [...from]
  const b = [...value]
  const same = a.length === b.length
  return (
    <span className={cls}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" key={gen}>
        {b.map((ch, i) =>
          same && a[i] === ch ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: characters are positional
            <span key={i}>{ch}</span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: characters are positional
            <span key={i} className="nt-ch is-in">
              {ch}
            </span>
          ),
        )}
      </span>
    </span>
  )
}
