import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { PoolSummary } from '../../api/types.js'
import { NB } from '../../lib/format.js'
import { DEMO_POOLS } from '../charts/chartFixtures.js'
import { HealthCell, metricCell } from './PoolCells.js'

afterEach(cleanup)

const rated = { total: 71.4, grade: 'B', rated: true, unratedReason: null } as const
const unrated = (unratedReason: 'thin' | 'one-sided' | 'unpriced') =>
  ({ total: 38.2, grade: null, rated: false, unratedReason }) as const

describe('HealthCell', () => {
  it('shows the glyph and the truncated score of a rated pool', () => {
    render(<HealthCell health={rated} />)
    expect(screen.getByRole('img', { name: 'Grade B' })).toBeTruthy()
    expect(screen.getByText('71')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Not rated' })).toBeNull()
  })

  it('shows "Not rated" and its reason instead of a letter or a score', async () => {
    const reasons = {
      thin: 'Too thin to rate',
      'one-sided': 'Too thin on one side',
      unpriced: 'No USD price',
    } as const
    for (const [reason, words] of Object.entries(reasons)) {
      const { container, unmount } = render(
        <MemoryRouter>
          <HealthCell health={unrated(reason as keyof typeof reasons)} />
        </MemoryRouter>,
      )
      expect(within(container).queryByRole('img')).toBeNull()
      // its total is not a grade: the row does not show it
      expect(container.textContent).toBe('Not rated')
      fireEvent.focus(within(container).getByRole('button', { name: 'Not rated' }))
      expect((await screen.findByRole('tooltip')).textContent).toContain(words)
      unmount()
    }
  })
})

describe('metricCell', () => {
  const pool = (over: Partial<PoolSummary>): PoolSummary => {
    const base = DEMO_POOLS[0]
    if (!base) throw new Error('no fixture pool')
    return { ...base, ...over }
  }

  it('shows the health total of a rated pool and "—" for an unrated one', () => {
    expect(metricCell(pool({ health: rated }), 'health')).toBe('71')
    const { container } = render(
      <MemoryRouter>{metricCell(pool({ health: unrated('thin') }), 'health')}</MemoryRouter>,
    )
    expect(container.textContent).toBe('—')
  })

  it('words a spread the pool cannot absorb where the spread would be', () => {
    expect(metricCell(pool({ spread10kBps: 13.8 }), 'spread')).toBe(`13.8${NB}bps`)
    for (const spread10kBps of [null, 1.449e24, 10_000]) {
      expect(metricCell(pool({ spread10kBps }), 'spread')).toBe(`Can’t absorb $10K`)
    }
    // a pool with no USD price has no spread to talk about
    const { container } = render(
      <MemoryRouter>
        {metricCell(pool({ spread10kBps: null, health: unrated('unpriced') }), 'spread')}
      </MemoryRouter>,
    )
    expect(container.textContent).toBe('—')
  })
})
