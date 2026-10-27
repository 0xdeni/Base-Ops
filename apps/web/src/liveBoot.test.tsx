/**
 * The live build's startup (docs/design/web-v2.md §4): an API that answers renders the app, one
 * that does not answer shows the "data service is not answering" page (never made-up pools) with
 * a "Try again" button that probes again, the slow-start shell is skipped while retrying, and the
 * page carries no error text or stack trace.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiUnavailableError, type ResolvedClient } from './api/client.js'
import { createMockClient } from './api/mock.js'
import { startLive } from './liveBoot.js'

const NOW = 1_760_000_000
const LIVE: ResolvedClient = {
  client: createMockClient({ now: NOW }),
  mock: false,
  reason: null,
  demo: false,
  dataNow: null,
}

let mounted: { root: Root; container: HTMLElement } | null = null

/** Starts the app; resolves once `startLive` has finished unless `settle` is false (a slow probe). */
async function boot(
  resolve: () => Promise<ResolvedClient>,
  shellAfter = 300,
  settle = true,
): Promise<void> {
  window.history.pushState({}, '', '/pools')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => {
    const started = startLive(root, resolve, shellAfter)
    if (settle) await started
  })
}

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  window.history.pushState({}, '', '/')
  vi.restoreAllMocks()
})

describe('live build startup', () => {
  it('renders the app on the client the probe found', async () => {
    await boot(async () => LIVE)
    expect(await screen.findByRole('table', { name: 'Pools' })).toBeTruthy()
    expect(screen.queryByText('The data service is not answering.')).toBeNull()
    // Live data: no demo or mock line.
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows the not-answering page instead of data when the probe fails, and no error text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await boot(async () => {
      throw new ApiUnavailableError('internal detail that must not reach the page')
    })
    const alert = await screen.findByRole('alert')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'The data service is not answering.',
    )
    expect(alert.textContent).toMatch(/try again/i)
    // The page keeps its main landmark; the alert is the message inside it, not the button.
    const main = screen.getByRole('main')
    expect(main.getAttribute('role')).toBeNull()
    expect(main.contains(alert)).toBe(true)
    expect(alert.contains(screen.getByRole('heading', { level: 1 }))).toBe(true)
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(main.contains(retry)).toBe(true)
    expect(alert.contains(retry)).toBe(false)
    // Nothing is made up and nothing technical is printed.
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).not.toMatch(/internal detail|Error:|at \w+ \(|stack/)
    expect(document.title).toBe('Data service not answering – Depthwatch')
    expect(warn).toHaveBeenCalled()
  })

  it('"Try again" probes again: still down keeps the page, an answer renders the app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let up = false
    const resolve = vi.fn(async () => {
      if (!up) throw new ApiUnavailableError()
      return LIVE
    })
    await boot(resolve)
    expect(resolve).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    })
    expect(resolve).toHaveBeenCalledTimes(2)
    // Still down: the same page, and the button is usable again.
    const again = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'The data service is not answering.',
    )

    up = true
    await act(async () => {
      fireEvent.click(again)
    })
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(await screen.findByRole('table', { name: 'Pools' })).toBeTruthy()
    expect(screen.queryByText('The data service is not answering.')).toBeNull()
  })

  it('does not swap the not-answering page for the loading shell while a retry waits', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let release: (value: ResolvedClient) => void = () => undefined
    const calls: number[] = []
    const resolve = async (): Promise<ResolvedClient> => {
      calls.push(calls.length)
      if (calls.length === 1) throw new ApiUnavailableError()
      return new Promise((done) => {
        release = done
      })
    }
    await boot(resolve, 0)
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    // The retry is pending: the page is still there, its button busy and not clickable twice.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'The data service is not answering.',
    )
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.queryByText('Connecting…')).toBeNull()
    await act(async () => release(LIVE))
    expect(await screen.findByRole('table', { name: 'Pools' })).toBeTruthy()
  })

  it('shows the loading shell for a slow probe, then the app', async () => {
    let release: (value: ResolvedClient) => void = () => undefined
    const resolve = () =>
      new Promise<ResolvedClient>((done) => {
        release = done
      })
    await boot(resolve, 0, false)
    expect(await screen.findByText('Connecting…')).toBeTruthy()
    await act(async () => release(LIVE))
    expect(await screen.findByRole('table', { name: 'Pools' })).toBeTruthy()
  })
})
