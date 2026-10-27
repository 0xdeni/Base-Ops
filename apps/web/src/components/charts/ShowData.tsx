/**
 * "Show data" (CH9, docs/design/visual-v3.md §5.9): the non-pointer route to every chart's numbers.
 * Each chart takes its table as `children` and renders it here, in a disclosure 12 px under the
 * figure (8 px under the butterfly). Nothing renders without a table.
 */
import type { ReactNode } from 'react'
import { Disclosure } from '../ui/Disclosure.js'

export function ShowData({ children, className }: { children?: ReactNode; className?: string }) {
  if (children === undefined || children === null || children === false) return null
  return (
    <div className={`chart-foot${className ? ` ${className}` : ''}`}>
      <Disclosure label="Show data">{children}</Disclosure>
    </div>
  )
}
