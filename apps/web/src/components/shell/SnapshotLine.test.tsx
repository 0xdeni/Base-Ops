/**
 * The shell over a published live snapshot (docs/design/web-v2.md §4, visual-v3.md §5.1): the
 * snapshot line in the demo line's slot, freshness as an absolute time, the footer's source, and
 * no "… ago" on the pages; without a snapshot the demo and live shells stay as they were.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import type { StaticSnapshot } from '../../api/static.js'
import { DEFAULT_SNAPSHOT_NOTE, noteParagraphs, snapshotFacts } from './SnapshotLine.js'

const NOW = 1_760_000_000
const NB = '\u00a0'
const SNAPSHOT: StaticSnapshot = {
  // 9 Oct 2025, 08:40 UTC; exported 20 minutes later.
  at: NOW - 800,
  exportedAt: NOW + 400,
  block: '53063332',
  note: 'The 492 largest pools by TVL.\n\n  Volume covers the last 24 h.  ',
}
const AT = `9${NB}Oct${NB}2025, 08:40${NB}UTC`

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(cleanup)

function renderAt(path: string, opts: { snapshot?: StaticSnapshot; demo?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers
      client={createMockClient({ now: NOW })}
      mock={false}
      demo={opts.demo}
      dataNow={opts.demo ? NOW : undefined}
      snapshot={opts.snapshot}
      staticBuild
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('snapshot line', () => {
  it('says snapshot of Base mainnet, the UTC date and time, and that the page does not update', () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    const line = screen.getByRole('note', { name: 'Data source' })
    expect(line.querySelector('.snap-wide')?.textContent).toBe(
      `Snapshot of Base mainnet, ${AT}. This page does not update.`,
    )
    // Below 840 px the shorter sentence shows, and the link reads "About"; below 360 px the
    // sentence drops its year.
    expect(line.querySelector('.snap-narrow')?.textContent).toBe(`Snapshot of ${AT}, not live`)
    expect(line.querySelector('.snap-year')?.textContent).toBe(`${NB}2025`)
    const about = within(line).getByRole('button', { name: 'About this snapshot' })
    expect(about.className).toBe('quiet-link touch-hit')
    expect(about.querySelector('.snap-more')?.textContent).toBe(' this snapshot')
    expect(line.textContent).not.toMatch(/demo|mock/i)
  })

  it('opens the note in paragraphs with the block and the export time', () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    fireEvent.click(screen.getByRole('button', { name: 'About this snapshot' }), { detail: 1 })
    const pop = screen.getByRole('dialog', { name: 'About this snapshot' })
    expect([...pop.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'The 492 largest pools by TVL.',
      'Volume covers the last 24 h.',
      `Read at block 53,063,332. Exported 9${NB}Oct${NB}2025, 09:00${NB}UTC.`,
    ])
  })

  it('explains the copy without a note, and leaves out an unknown block', () => {
    expect(noteParagraphs('a\n\n\n b \n\n')).toEqual(['a', 'b'])
    expect(snapshotFacts({ ...SNAPSHOT, block: null })).toBe(
      `Exported 9${NB}Oct${NB}2025, 09:00${NB}UTC.`,
    )
    renderAt('/methodology', { snapshot: { ...SNAPSHOT, note: null } })
    fireEvent.click(screen.getByRole('button', { name: 'About this snapshot' }), { detail: 1 })
    const pop = screen.getByRole('dialog', { name: 'About this snapshot' })
    expect(pop.querySelector('p')?.textContent).toBe(DEFAULT_SNAPSHOT_NOTE)
  })
})

describe('freshness and footer of a snapshot', () => {
  it('gives the absolute snapshot time with a hollow dot, never "Updated … ago"', async () => {
    renderAt('/methodology', { snapshot: SNAPSHOT })
    const fresh = await screen.findByRole('button', {
      name: `Data freshness: as of 9${NB}Oct, 08:40${NB}UTC`,
    })
    expect(fresh.textContent).toBe(`As of 9${NB}Oct, 08:40${NB}UTC`)
    expect(fresh.querySelector('.fresh-dot')?.classList.contains('is-snapshot')).toBe(true)
    expect(fresh.getAttribute('title')).toMatch(/^Block [\d,]+, [\d,]+ of [\d,]+ pools tracked, /)
    fireEvent.click(fresh, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect([...pop.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Snapshot',
      'Block',
      'Pools tracked',
      'Exported',
    ])
    expect([...pop.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
      AT,
      expect.stringMatching(/^\d{1,3}(,\d{3})+$/),
      expect.stringMatching(/^[\d,]+ of [\d,]+$/),
      `9${NB}Oct${NB}2025, 09:00${NB}UTC`,
    ])
    expect(
      within(screen.getByRole('contentinfo')).getByText('Data: Base mainnet snapshot'),
    ).toBeTruthy()
  })

  it('dates the pools caption instead of aging it', async () => {
    renderAt('/pools', { snapshot: SNAPSHOT })
    await screen.findByRole('table', { name: 'Pools' })
    const main = screen.getByRole('main')
    expect(main.textContent).toMatch(/[Uu]pdated \d+\u00a0\w{3}, \d\d:\d\d\u00a0UTC/)
    expect(main.textContent).not.toMatch(/\bago\b/)
  })

  it('keeps the demo shell unchanged when there is no snapshot', async () => {
    renderAt('/methodology', { demo: true })
    expect(screen.getByRole('note', { name: 'Data source' }).textContent).toMatch(
      /^Demo data: a synthetic week of Base/,
    )
    expect(document.querySelector('.snap-text')).toBeNull()
    expect(
      await screen.findByRole('button', { name: `Data freshness: updated 1${NB}min ago` }),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('contentinfo')).getByText('Data: synthetic demo world'),
    ).toBeTruthy()
  })
})
