import { useCallback, useSyncExternalStore } from 'react'

/** The phone layout: below 52.5em (840 px), docs/design/visual-v4.md §3.5. */
export const PHONE_QUERY = '(max-width: 52.49em)'

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

/**
 * Whether `query` matches now, re-rendering when it starts or stops matching. False where
 * `matchMedia` does not exist (server render, jsdom without a stub).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query)
      if (!list || typeof list.addEventListener !== 'function') return () => {}
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => mediaList(query)?.matches ?? false,
    () => false,
  )
}

/** True below 840 px: the phone app bar, tab strip, sheets and phone rows. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
