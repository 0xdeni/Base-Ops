/**
 * Not found (`*`, ia-v3 §3.5, docs/design/visual-v3.md §5.12 and §6.9): the h1 says what was not
 * found, one sentence follows, the requested path is shown in mono 16 px below, then "Browse pools"
 * (secondary) and "See liquidity gaps" (prose link) 32 px below, on the page grid with 48 px of top
 * padding. Pool, token and scorecard 404s render the same state from their own pages.
 */
import { useLocation } from 'react-router-dom'
import { NotFoundState } from '../components/ui/States.js'

export function NotFound() {
  const { pathname } = useLocation()
  return (
    <>
      <title>Not found – Depthwatch</title>
      <NotFoundState
        title="Page not found"
        message="Depthwatch does not track this page, or the link is wrong."
        id={pathname}
      />
    </>
  )
}
