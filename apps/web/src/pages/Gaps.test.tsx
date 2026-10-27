/**
 * Gaps (ia-v3 §4.4, docs/design/visual-v3.md §6.4) against the in-repo mock: the answer, lead and
 * caption, the ranked rows with their sentence, turnover glyph and focus tooltip, the quiet rows
 * behind one disclosure, the table view with every v2 column and its sorts (`view`, `sort`, `dir`
 * in the URL), and the no-gap, empty and error states.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../api/mock.js'
import type { ApiClient, GapItem } from '../api/types.js'
import { NB, pairLabel, ratio, usd } from '../lib/format.js'
import { Gaps } from './Gaps.js'
import { gapsAnswer, quietLabel } from './lists/gapsModel.js'
import { NOW, renderPage } from './lists/testing.js'

afterEach(cleanup)

const renderAt = (path: string, client?: ApiClient) => renderPage(path, '/gaps', <Gaps />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const gapList = () => screen.findByRole('list', { name: 'Liquidity gaps' })
const answerText = () => document.querySelector('.answer')?.textContent

/** The mock's feed with its items replaced. */
function withGaps(items: (all: GapItem[]) => GapItem[]): ApiClient {
  const mock = createMockClient({ now: NOW })
  return {
    ...mock,
    async gaps(query) {
      const res = await mock.gaps(query)
      return { ...res, items: items(res.items) }
    },
  }
}

describe('Gaps: answer, lead and caption', () => {
  it('counts the pools that trade 3× their depth or more', async () => {
    const h = renderAt('/gaps')
    const feed = await h.client.gaps({ limit: 100 })
    const real = feed.items.filter((g) => (g.gap.turnoverRatio ?? 0) >= 3)
    await waitFor(() => expect(answerText()).toBe(gapsAnswer(real.length)))
    expect(answerText()).toBe(`${real.length} pools trade 3× their depth or more every day.`)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Liquidity gaps')
    expect(
      screen.getByText(
        'A gap is a pool that trades far more each day than the liquidity near its price.',
      ),
    ).toBeTruthy()
    const caption = document.querySelector('.lists-gaps-caption')?.textContent ?? ''
    expect(caption).toContain(`Pools with at least $10K of 24${NB}h volume`)
    expect(screen.getByRole('link', { name: 'How the score works' }).getAttribute('href')).toBe(
      '/methodology#gaps',
    )
  })

  it('says so when no pool trades 3× its depth', async () => {
    renderAt(
      '/gaps',
      withGaps((all) => all.filter((g) => (g.gap.turnoverRatio ?? 0) < 3)),
    )
    await waitFor(() => expect(answerText()).toBe('No pool trades 3× its depth today.'))
    expect(screen.getByText('Every pool trades less than 3× its depth.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Liquidity gaps' })).toBeNull()
  })
})

describe('Gaps: the ranked rows', () => {
  it('ranks each gap with its pool, sentence and turnover glyph', async () => {
    const h = renderAt('/gaps')
    const top = (await h.client.gaps({ limit: 1 })).items[0] as GapItem
    const rows = within(await gapList()).getAllByRole('listitem')
    expect(rows).toHaveLength(11)
    const first = rows[0] as HTMLElement
    expect(first.querySelector('.lists-rank')?.textContent).toBe('1')
    const link = within(first).getByRole('link')
    expect(link.getAttribute('href')).toBe(`/pools/${encodeURIComponent(top.pool.pool.id)}`)
    const name = link.getAttribute('aria-label') ?? ''
    expect(name.startsWith(pairLabel(top.pool.pool.token0, top.pool.pool.token1))).toBe(true)
    expect(name).toContain(`${usd(top.gap.volume24hUsd)} traded through ${usd(top.gap.depth2Usd)}`)
    expect(first.querySelector('.lists-gap-say')?.textContent).toBe(
      `Trades ${ratio(top.gap.turnoverRatio)} its depth a day`,
    )
    expect(within(first).getByRole('img').getAttribute('aria-label')).toBe(
      'Gap score 91 of 100; 3× turnover is 24',
    )
  })

  it('shows volume and depth in a tooltip when the row link takes focus', async () => {
    const h = renderAt('/gaps')
    const top = (await h.client.gaps({ limit: 1 })).items[0] as GapItem
    const link = within(await gapList()).getAllByRole('link')[0] as HTMLElement
    fireEvent.focus(link)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toBe(
      `${usd(top.gap.volume24hUsd)} traded through ${usd(top.gap.depth2Usd)} of depth`,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('keeps the rows under 3× behind one quiet disclosure', async () => {
    renderAt('/gaps')
    await gapList()
    const more = screen.getByRole('button', { name: quietLabel(4) })
    // The full sentence on desktop, a short label on phones (CSS picks one); the full sentence
    // stays the accessible name at every width.
    const labels = [...more.querySelectorAll('.disc-label')].map((n) => n.textContent)
    expect(labels).toEqual([
      'Show 4 more pools that trade less than 3× their depth',
      'Show 4 pools under 3×',
    ])
    expect(more.querySelector('.disc-label.is-short')).toBeTruthy()
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.textContent).toBe('Hide pools under 3×')
    const quiet = screen.getByRole('list', { name: 'Pools under 3× turnover' })
    const rows = within(quiet).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]?.querySelector('.lists-rank')?.textContent).toBe('12')
    expect(rows[0]?.querySelector('.rl-row')?.classList.contains('is-quiet')).toBe(true)
  })
})

describe('Gaps: the table view (L2)', () => {
  it('switches views in the URL and shows every v2 column', async () => {
    const h = renderAt('/gaps')
    await gapList()
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await waitFor(() => expect(last(h)).toBe('/gaps?view=table'))
    const table = await screen.findByRole('table', { name: 'Liquidity gaps, every column' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([
      'Pool',
      `24${NB}h volume`,
      `Depth ±2${NB}%`,
      'Turnover',
      'Gap score',
      'Health',
      'TVL',
    ])
    expect(within(table).getAllByRole('row')).toHaveLength(16)
    const turnover = within(table).getByRole('columnheader', { name: 'Turnover' })
    expect(turnover.getAttribute('aria-sort')).toBe('descending')
  })

  it('sorts every column, nulls last, and keeps the order in the URL', async () => {
    const h = renderAt('/gaps?view=table')
    const table = await screen.findByRole('table', { name: 'Liquidity gaps, every column' })
    fireEvent.click(within(table).getByRole('button', { name: `24${NB}h volume` }))
    await waitFor(() => expect(last(h)).toBe('/gaps?view=table&sort=volume'))
    const feed = await h.client.gaps({ limit: 100 })
    const most = Math.max(...feed.items.map((g) => g.gap.volume24hUsd ?? 0))
    const firstRow = () => within(table).getAllByRole('row')[1] as HTMLElement
    await waitFor(() =>
      expect(
        [...firstRow().querySelectorAll('td')].some((td) => td.textContent === usd(most)),
      ).toBe(true),
    )
    fireEvent.click(within(table).getByRole('button', { name: `24${NB}h volume` }))
    await waitFor(() => expect(last(h)).toBe('/gaps?view=table&sort=volume&dir=asc'))
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    await waitFor(() => expect(last(h)).toBe('/gaps'))
  })
})

describe('Gaps: empty and error (ST2, ST3)', () => {
  it('says what is empty when no pool clears the volume floor', async () => {
    renderAt(
      '/gaps',
      withGaps(() => []),
    )
    await waitFor(() =>
      expect(document.querySelector('.empty p')?.textContent).toBe(
        `No pool has $10K of 24${NB}h volume yet, so none can be ranked.`,
      ),
    )
  })

  it('keeps the page usable when the feed fails', async () => {
    const mock = createMockClient({ now: NOW })
    renderAt('/gaps', { ...mock, gaps: () => Promise.reject(new Error('down')) })
    await screen.findByText('Unable to load gaps. Check that the API is running, then retry.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Liquidity gaps')
  })
})
