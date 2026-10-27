import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import { BackLink } from './BackLink.js'
import { Button, IconButton } from './Button.js'
import { CopyButton } from './CopyButton.js'
import { Fact, Facts } from './Fact.js'
import { GradeGlyph } from './GradeGlyph.js'
import { ICON_NAMES, Icon } from './Icon.js'
import { NotFoundState, SectionError, useDelayedPending } from './States.js'
import { StatusChip } from './StatusChip.js'
import { StatusWord } from './StatusWord.js'
import { TextChange } from './TextChange.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('icons and buttons (K1, K9)', () => {
  it('draws every icon as a 16 px, 1.5 px stroke, aria-hidden SVG', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
      expect(svg?.getAttribute('stroke-width')).toBe('1.5')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      unmount()
    }
  })

  it('names icon buttons and keeps a loading button labelled', () => {
    render(
      <>
        <IconButton icon="swap" label="Show price in WETH" />
        <Button loading>Retry</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Show price in WETH' }).className).toBe('icon-btn')
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry.getAttribute('aria-busy')).toBe('true')
    expect(retry.querySelector('.spinner')).toBeTruthy()
  })

  it('back link: a chevron icon plus the list name, never a text arrow (K2)', () => {
    render(
      <MemoryRouter>
        <BackLink to="/pools" label="Pools" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Pools' })
    expect(link.getAttribute('href')).toBe('/pools')
    expect(link.querySelector('svg')).toBeTruthy()
    expect(link.textContent).toBe('Pools')
  })
})

describe('grades and status (C4, K5): shape plus word', () => {
  it('names the grade glyph and picks the band shape', () => {
    render(
      <>
        <GradeGlyph grade="A" />
        <GradeGlyph grade="C" size="fact" />
        <GradeGlyph grade="F" />
      </>,
    )
    const [a, c, f] = screen.getAllByRole('img')
    expect(a?.getAttribute('aria-label')).toBe('Grade A')
    expect(a?.className).toBe('grade tone-ok')
    expect(a?.querySelector('circle')).toBeTruthy()
    expect(c?.className).toBe('grade tone-warn is-fact')
    expect(c?.querySelector('rect')).toBeTruthy()
    expect(f?.querySelector('path')).toBeTruthy()
  })

  it('writes the status words with a shape, filled only as the chip', () => {
    render(
      <>
        <StatusWord status="ok" />
        <StatusWord status="breached" />
        <StatusChip status="breached" compact />
      </>,
    )
    expect(screen.getByText('Within KPI').className).toBe('status tone-ok')
    const [word, chip] = screen.getAllByText('Breached')
    expect(word?.className).toBe('status tone-bad')
    expect(chip?.className).toBe('status-chip tone-bad is-compact')
    expect(chip?.querySelector('svg')).toBeTruthy()
  })
})

describe('facts (D3): value first, label second', () => {
  it('pairs each value with its label, glyph or breached triangle', () => {
    render(
      <Facts layout="scorecard">
        <Fact value="$7.82K" label="sell side now, below the $50K KPI" breached />
        <Fact value="82" label="median health" grade="A" />
      </Facts>,
    )
    const terms = screen.getAllByRole('term').map((t) => t.textContent)
    expect(terms).toEqual(['sell side now, below the $50K KPI', 'median health'])
    const values = screen.getAllByRole('definition')
    expect(values[0]?.textContent).toBe('$7.82K')
    expect(screen.getByRole('img', { name: 'Below KPI' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Grade A' })).toBeTruthy()
    expect(document.querySelector('dl')?.className).toBe('facts is-stack')
  })
})

describe('number change (§4 row 12)', () => {
  it('swaps instantly when not animated', () => {
    const { rerender, container } = render(<TextChange value="$7.82K" animate={false} />)
    rerender(<TextChange value="$7.66K" animate={false} />)
    expect(container.textContent).toBe('$7.66K')
    expect(container.querySelector('.nt-ch')).toBeNull()
  })

  it('settles in only the characters that changed, and reads the whole value', () => {
    const { rerender, container } = render(<TextChange value="$7.82K" />)
    rerender(<TextChange value="$7.66K" />)
    const changed = [...container.querySelectorAll('.nt-ch.is-in')].map((n) => n.textContent)
    expect(changed).toEqual(['6', '6'])
    expect(container.querySelector('.sr-only')?.textContent).toBe('$7.66K')
    expect(container.firstElementChild?.className).toBe('roll')
  })
})

describe('copy (K8)', () => {
  it('reads "Copied" with a check for 2 s and announces it', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<CopyButton text="<img>" label="Copy HTML" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy HTML' }))
    })
    expect(writeText).toHaveBeenCalledWith('<img>')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Copied')
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })
})

describe('states (ST1–ST4, M10)', () => {
  it('shows no loading UI under 300 ms and keeps it at least 400 ms once shown', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ p }) => useDelayedPending(p), {
      initialProps: { p: true },
    })
    act(() => vi.advanceTimersByTime(299))
    expect(result.current).toBe(false)
    rerender({ p: false })
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(false)
    rerender({ p: true })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe(true)
    rerender({ p: false })
    act(() => vi.advanceTimersByTime(399))
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(false)
  })

  it('reports a section failure with a Retry and no apology (ST3)', () => {
    const onRetry = vi.fn()
    render(<SectionError what="history" onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain(
      'Unable to load history. Check that the API is running, then retry.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says what was not found, shows the id and two ways on (ST4)', () => {
    render(
      <Providers client={createMockClient()} mock staticBuild>
        <MemoryRouter>
          <NotFoundState
            title="Pool not found"
            message="Depthwatch does not track this pool, or the link is wrong."
            id="uniswap-v3:0xdead"
          />
        </MemoryRouter>
      </Providers>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Pool not found' })).toBeTruthy()
    expect(screen.getByText('uniswap-v3:0xdead').className).toBe('mono nf-id')
    expect(
      screen.getByText(/This static copy only holds the data it was exported with\./),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse pools' }).className).toBe('btn secondary')
    expect(screen.getByRole('link', { name: 'See liquidity gaps' }).className).toBe('plink')
  })
})
