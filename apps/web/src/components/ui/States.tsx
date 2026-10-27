/**
 * States (ST1–ST7, docs/design/visual-v3.md §5.12, M10). Loading shows nothing for responses under
 * 300 ms and, once shown, keeps the skeleton at least 400 ms; skeletons are static `well` blocks at
 * the final heights (CLS 0). A refetch keeps the content, dims it after 150 ms and shows a 2 px bar
 * at the section top; it never falls back to a skeleton. Empty, section error and not found say
 * what happened and the next step.
 */
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useIsStatic } from '../../api/context.js'
import { Wordmark } from '../shell/Logo.js'
import { Button, ButtonLink } from './Button.js'

/** Show a loading UI only after `delay` ms of pending, then for at least `min` ms (M10). */
export function useDelayedPending(pending: boolean, delay = 300, min = 400): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (pending && !shown) {
      const t = setTimeout(() => {
        shownAt.current = Date.now()
        setShown(true)
      }, delay)
      return () => clearTimeout(t)
    }
    if (!pending && shown) {
      const left = Math.max(0, min - (Date.now() - shownAt.current))
      const t = setTimeout(() => setShown(false), left)
      return () => clearTimeout(t)
    }
    return undefined
  }, [pending, shown, delay, min])
  return shown
}

/** A static `well` block at the final layout's size. */
export function Skeleton({
  height,
  width = '100%',
  className,
  style,
}: {
  height: number | string
  width?: number | string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={`skel${className ? ` ${className}` : ''}`}
      style={{ height, width, ...style }}
      aria-hidden="true"
    />
  )
}

/**
 * A skeleton region: hidden from assistive tech except for one polite "Loading" label. While
 * `hidden` (the first 300 ms, M10) its blocks keep their final sizes but are not painted, so the
 * page already has its loaded height and nothing below it (the footer) moves when it shows.
 */
export function SkeletonGroup({
  label = 'Loading',
  hidden = false,
  className,
  children,
}: {
  label?: string
  hidden?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`skel-stack${className ? ` ${className}` : ''}`}
      role="status"
      aria-label={label}
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      {children}
    </div>
  )
}

/** Keeps refetched content in place, dimmed after 150 ms, under a 2 px indeterminate bar. */
export function Refetch({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <div className={`refetch${busy ? ' is-busy' : ''}`} aria-busy={busy || undefined}>
      <span className="refetch-bar" aria-hidden="true">
        <i />
      </span>
      <div className="refetch-body">{children}</div>
    </div>
  )
}

/** One sentence that says what is empty and the next step, plus at most one action (ST2). */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action ?? null}
    </div>
  )
}

/**
 * A failure inside a section (ST3): the rest of the page stays usable. No "we", no apology.
 */
export function SectionError({
  what = 'data',
  onRetry,
}: {
  /** What failed to load: "history", "pools". */
  what?: string
  onRetry?: () => void
}) {
  return (
    <div className="sec-error" role="alert">
      <p>Unable to load {what}. Check that the API is running, then retry.</p>
      {onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
    </div>
  )
}

export interface NotFoundLinks {
  /** The secondary button ("Browse pools"). */
  primary: { to: string; label: string }
  /** The prose link ("See liquidity gaps"). */
  secondary: { to: string; label: string }
}

/**
 * Not found (ST4, ia-v3 §3.5): h1 "Pool not found", one sentence, the id in mono 16 px below,
 * then a secondary button and a prose link 32 px below. The static copy adds why a shared link
 * can miss.
 */
export function NotFoundState({
  title,
  message,
  id,
  links = {
    primary: { to: '/pools', label: 'Browse pools' },
    secondary: { to: '/gaps', label: 'See liquidity gaps' },
  },
}: {
  title: string
  message: string
  id?: string
  links?: NotFoundLinks
}) {
  const staticBuild = useIsStatic()
  return (
    <div className="wrap page not-found">
      <h1 className="h1">{title}</h1>
      <p className="answer answer-block">
        {message}
        {staticBuild ? ' This static copy only holds the data it was exported with.' : null}
      </p>
      {id ? <p className="mono nf-id">{id}</p> : null}
      <div className="actions">
        <ButtonLink to={links.primary.to}>{links.primary.label}</ButtonLink>
        <Link className="plink" to={links.secondary.to}>
          {links.secondary.label}
        </Link>
      </div>
    </div>
  )
}

/**
 * The page a production dashboard shows when `/api/health` does not answer at start-up (ST3 at
 * page level; ST7 keeps a full-page takeover for the case with no data to show at all). It says
 * what happened, what to do and offers "Try again", which re-runs the probe; no stack trace and
 * no error text. It renders before any provider exists, so it uses neither router nor context.
 */
export function ServiceDownState({ onRetry }: { onRetry: () => unknown }) {
  const [busy, setBusy] = useState(false)
  const retry = () => {
    setBusy(true)
    // On success the app replaces this page; on failure the button comes back.
    void Promise.resolve(onRetry()).finally(() => setBusy(false))
  }
  return (
    <>
      <title>Data service not answering – Depthwatch</title>
      <header className="appbar">
        <div className="wrap appbar-inner">
          <span className="brand">
            <Wordmark />
          </span>
        </div>
      </header>
      <main className="wrap page service-down">
        {/* The alert wraps the message only: the page stays the main landmark, and the button
            going busy on a failed retry does not announce the page again. */}
        <div role="alert">
          <h1 className="h1">The data service is not answering.</h1>
          <p className="answer answer-block">
            Depthwatch cannot show liquidity data until it is back. Wait a minute, then try again.
            If it keeps failing, whoever runs this site needs to start the data service.
          </p>
        </div>
        <div className="actions">
          <Button onClick={retry} loading={busy} disabled={busy}>
            Try again
          </Button>
        </div>
      </main>
    </>
  )
}
