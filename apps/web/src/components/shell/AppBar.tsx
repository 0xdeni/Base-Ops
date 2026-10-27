/**
 * The app bar (docs/design/visual-v3.md §5.1): 56 px and sticky on desktop; on phones a 52 px bar
 * plus the same <nav> as a 44 px tab strip. It never hides. Its hairline fades in once the page
 * has scrolled past 36 px (the demo line plus 8, §4 row 18).
 */
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Freshness } from './Freshness.js'
import { Wordmark } from './Logo.js'
import { Nav } from './Nav.js'

export const SCROLLED_PX = 36

export function AppBar({ navAnimate }: { navAnimate: boolean }) {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const onScroll = () =>
      ref.current?.classList.toggle('is-scrolled', window.scrollY > SCROLLED_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header ref={ref} className="appbar">
      <div className="wrap appbar-inner">
        <Link className="brand" to="/" aria-label="Depthwatch home">
          <Wordmark />
        </Link>
        <Nav animate={navAnimate} />
        <Freshness />
      </div>
    </header>
  )
}
