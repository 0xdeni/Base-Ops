/**
 * Route data on intent (docs/design/visual-v3.md §4 row 6, §5.12 ST1). The route cross-fade
 * snapshots the new <main> as it is when the navigation commits, and React holds later commits
 * until the fade ends; a route whose data is not in the cache would cross-fade to an empty page
 * and pop in afterwards. So:
 * - a pointer resting on an in-app link, pressing it, or keyboard focus on it prefetches what the
 *   target route reads first (`routeQueries`), with the page's own keys and fetchers;
 * - a pointer click that will cross-fade to a route whose data is still missing is held for at
 *   most `ROUTE_WAIT_MS` while that data loads, then replayed on the same element, so the router
 *   (and the Link's own props) handle it exactly as the original click.
 * Keyboard and reduced-motion navigations never cross-fade, so they are never held.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { ApiClient } from '../api/types.js'
import { missingQueries, type RouteQuery, routeQueries } from '../routeData.js'

/** The longest a pointer click waits for its route's data before it navigates anyway. */
export const ROUTE_WAIT_MS = 120

/** The in-app link an event happened on, with its raw href. */
export function linkOf(target: EventTarget | null): { a: Element; href: string } | null {
  const a = target instanceof Element ? target.closest('a[href]') : null
  if (!a || a.hasAttribute('download')) return null
  const t = a.getAttribute('target')
  if (t && t !== '_self') return null
  return { a, href: a.getAttribute('href') ?? '' }
}

/**
 * Starts loading what the link's route reads first and resolves once it is in (failures
 * included: the page shows its own error). Cached or in-flight data is reused, not refetched.
 * Null when the route already has everything it reads first.
 */
export function prefetchRoute(qc: QueryClient, api: ApiClient, href: string): Promise<void> | null {
  const missing: RouteQuery[] = missingQueries(qc, routeQueries(href, api))
  if (!missing.length) return null
  return Promise.all(
    missing.map((q) => qc.prefetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn })),
  ).then(() => undefined)
}

/** Clicks this module dispatched itself: they pass through untouched. */
const replays = new WeakSet<Event>()

export interface ClickHold {
  /**
   * Called for a pointer click that will cross-fade. True when the click was held (its default
   * prevented) because the route's data is missing; it is replayed once the data is in, or after
   * `ROUTE_WAIT_MS`, whichever comes first.
   */
  hold: (e: MouseEvent) => boolean
}

export function createClickHold(
  qc: QueryClient,
  api: ApiClient,
  wait: number = ROUTE_WAIT_MS,
): ClickHold {
  let latest = 0
  return {
    hold(e) {
      if (replays.has(e)) return false
      const link = linkOf(e.target)
      if (!link) return false
      const loaded = prefetchRoute(qc, api, link.href)
      if (!loaded) return false
      e.preventDefault()
      const ticket = ++latest
      const target = e.target as Element
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, wait))
      void Promise.race([loaded, timeout]).then(() => {
        // A later click (another link, or the same one again) supersedes this one.
        if (ticket !== latest || !target.isConnected) return
        const replay = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: e.view,
          detail: Math.max(1, e.detail),
          button: 0,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        })
        replays.add(replay)
        target.dispatchEvent(replay)
      })
      return true
    },
  }
}
