import { useCallback, useSyncExternalStore } from 'react'

/** The phone layout: below 52.5em (840 px), docs/design/visual-v3.md §3.4. */
export const PHONE_QUERY = '(max-width: 52.49em)'
/** Hover styles and the lens's pointer path apply to fine pointers only (§4 row 17). */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'
/** Touch: 44 px targets, tap paths instead of hover. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)'

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

/** True for a mouse or trackpad: hover reveals, the lens follows the pointer. */
export function useFinePointer(): boolean {
  return useMediaQuery(FINE_POINTER_QUERY)
}

/** True for touch: tap paths and 44 px targets. */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY)
}
