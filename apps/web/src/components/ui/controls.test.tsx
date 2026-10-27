import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBadge } from '../../lib/badge.js'
import { BadgePreview, EmbedActions, EmbedCode } from './EmbedBadge.js'
import { Checkbox, SearchInput } from './Inputs.js'
import { PoolCell, SortHeader } from './Table.js'

afterEach(cleanup)

describe('inputs (K6, §5.4)', () => {
  it('labels the search field for assistive tech, never by placeholder alone', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByRole('searchbox', { name: 'Search pools' })
    expect(input.getAttribute('placeholder')).toBe('Search by symbol or address')
    fireEvent.change(input, { target: { value: 'aero' } })
    expect(onChange).toHaveBeenCalledWith('aero')
  })

  it('tells a pointer toggle from a keyboard one, so the context morph can be skipped', () => {
    const onChange = vi.fn()
    render(
      <Checkbox checked={false} onChange={onChange}>
        Whole-pool depth
      </Checkbox>,
    )
    const box = screen.getByRole('checkbox', { name: 'Whole-pool depth' })
    fireEvent.pointerDown(box)
    fireEvent.click(box)
    expect(onChange).toHaveBeenLastCalledWith(true, { keyboard: false })
    fireEvent.click(box)
    expect(onChange).toHaveBeenLastCalledWith(true, { keyboard: true })
  })
})

describe('table parts (TB3, TB4)', () => {
  it('marks the sorted column with aria-sort and makes headers buttons', () => {
    const onSort = vi.fn()
    render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Health" active dir="desc" onSort={onSort} />
            <SortHeader label="TVL" active={false} dir="desc" onSort={onSort} />
          </tr>
        </thead>
      </table>,
    )
    const [health, tvl] = screen.getAllByRole('columnheader')
    expect(health?.getAttribute('aria-sort')).toBe('descending')
    expect(tvl?.hasAttribute('aria-sort')).toBe(false)
    fireEvent.click(within(tvl as HTMLElement).getByRole('button', { name: 'TVL' }))
    expect(onSort).toHaveBeenCalledOnce()
  })

  it('writes the pool cell as one link plus the DEX and fee line', () => {
    render(
      <MemoryRouter>
        <PoolCell
          pool={{
            id: 'aerodrome-v2:0xabc',
            dex: 'aerodrome-v2',
            feePips: 3000,
            stable: true,
            token0: { symbol: 'USDC' },
            token1: { symbol: 'AERO' },
          }}
        />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'USDC / AERO' })
    expect(link.getAttribute('href')).toBe('/pools/aerodrome-v2%3A0xabc')
    expect(link.className).toBe('pp rl-link')
    expect(document.querySelector('.pd')?.textContent).toBe('Aerodrome v2, 0.3\u00a0%, stable pair')
  })
})

describe('embed badge (§5.11)', () => {
  it('previews the API badge unaltered and offers both snippets and the code', () => {
    const svg = renderBadge({ status: 'breached', uptime: { d7: { uptime: 0.429 } } })
    render(
      <>
        <BadgePreview svg={svg} alt="Depthwatch scorecard: Demo" />
        <EmbedActions html="<img src=x>" markdown="![x](x)" />
        <EmbedCode html="<img src=x>" markdown="![x](x)" url="https://example.org/badge.svg" />
      </>,
    )
    const img = screen.getByRole('img', { name: 'Depthwatch scorecard: Demo' })
    expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain('#b8232f')
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toBeTruthy()
    expect(screen.getByText('Cached for 5 minutes.')).toBeTruthy()
    expect([...document.querySelectorAll('.code-label')].map((n) => n.textContent)).toEqual([
      'HTML',
      'Markdown',
      'Badge URL',
    ])
  })
})
