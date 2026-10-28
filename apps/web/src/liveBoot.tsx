/**
 * Startup of the live build (`/api`, docs/design/web-v2.md §4): probe `/api/health`, then render
 * the app on the HTTP client. An API that answers within 300 ms renders the final app directly
 * (M10), demo line included, so nothing shifts; a slower one gets the shell at once (app bar
 * "Connecting…", nav, the route's title block and skeleton, footer) on a pending client whose
 * queries wait for the real one on the same cache.
 *
 * An API that does not answer never turns into made-up data: the mock client is used only when
 * `VITE_MOCK=1` or in the Vite dev server (`resolveClient`). A production build shows the
 * "data service is not answering" page instead, and its "Try again" button runs the probe again.
 */
import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'
import { App } from './App.js'
import { type ResolvedClient, resolveClient } from './api/client.js'
import { BOOT_SHELL_MS, createPendingClient } from './api/pending.js'
import { RootErrorBoundary } from './components/ErrorBoundary.js'
import { ServiceDownState } from './components/ui/States.js'

export async function startLive(
  root: Root,
  resolve: () => Promise<ResolvedClient> = () => resolveClient(),
  shellAfter: number = BOOT_SHELL_MS,
  /** False for a retry: the "not answering" page stays until the probe has an answer. */
  withShell = true,
): Promise<void> {
  const ready = resolve()
  const shell = withShell
    ? setTimeout(() => {
        const client = ready.then((r) => r.client)
        // Only the page's own queries read it; a failed probe is reported below, not by them.
        client.catch(() => undefined)
        root.render(
          <StrictMode>
            <RootErrorBoundary>
              <App client={createPendingClient(client)} mock={false} connecting />
            </RootErrorBoundary>
          </StrictMode>,
        )
      }, shellAfter)
    : undefined
  let resolved: ResolvedClient
  try {
    resolved = await ready
  } catch {
    clearTimeout(shell)
    console.warn('depthwatch: /api/health did not answer')
    root.render(<ServiceDownState onRetry={() => startLive(root, resolve, shellAfter, false)} />)
    return
  }
  clearTimeout(shell)
  if (resolved.reason === 'unreachable')
    console.warn('depthwatch: /api unreachable, using mock data (development server)')
  const { client, mock, demo, dataNow } = resolved
  // `depthwatch demo` answers `/api/health` with `source: 'demo'`: demo line, demo clock.
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <App client={client} mock={mock} demo={demo} dataNow={dataNow ?? undefined} />
      </RootErrorBoundary>
    </StrictMode>,
  )
}
