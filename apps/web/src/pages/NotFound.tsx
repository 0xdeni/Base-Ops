/**
 * Not found (`*`, ia-v3 §3.5, docs/design/visual-v4.md §5.12, §6.10): no band. The eyebrow "Not
 * found", the lowercase display title "page not found", one sentence, the requested path in mono,
 * then "Browse pools" (ghost) and "See liquidity gaps" (strong link), on the title section's grid;
 * the app column rests the footer on the viewport bottom. Pool, token and scorecard 404s render
 * the same state from their own pages.
 */
import { useLocation } from 'react-router-dom'
import { NotFoundState } from '../components/ui/States.js'

export function NotFound() {
  const { pathname } = useLocation()
  return (
    <>
      <title>Not found – Depthwatch</title>
      <NotFoundState
        title="page not found"
        message="Depthwatch does not track this page, or the link is wrong."
        id={pathname}
      />
    </>
  )
}
