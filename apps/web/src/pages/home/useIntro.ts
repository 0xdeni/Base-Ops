/**
 * The Home first view (M6, docs/design/visual-v3.md §4 rows 1–2): the butterfly grows from the
 * spine on the first Home render of a session only. The flag is written once the figure has drawn,
 * so leaving before the data arrives does not use the intro up. `?replay=1` replays it for
 * checking. Storage can be missing or blocked; then the intro simply plays.
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export const INTRO_KEY = 'dw-home-seen'

function seen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

/** True when this Home view should play the intro; `drawn` marks it as played for the session. */
export function useIntro(drawn: boolean): boolean {
  const [params] = useSearchParams()
  const replay = params.get('replay') === '1'
  const [intro] = useState(() => replay || !seen())
  useEffect(() => {
    if (!drawn) return
    try {
      window.sessionStorage.setItem(INTRO_KEY, '1')
    } catch {
      // Private mode or blocked storage: the intro plays again next time, nothing breaks.
    }
  }, [drawn])
  return intro
}
