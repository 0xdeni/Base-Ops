import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coolGlossary, Glossary } from './Glossary.js'
import { placePopover } from './Popover.js'

// jsdom has no PointerEvent: a MouseEvent that carries `pointerType` stands in.
class TestPointerEvent extends MouseEvent {
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? 'mouse'
  }
}

beforeEach(() => {
  coolGlossary()
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', TestPointerEvent)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderTerms() {
  return render(
    <MemoryRouter>
      <p>
        median{' '}
        <Glossary definition="One score from 0 to 100, built from four parts." anchor="health">
          health
        </Glossary>{' '}
        and{' '}
        <Glossary definition="Basis points: hundredths of a percent." anchor="spread">
          bps
        </Glossary>
      </p>
    </MemoryRouter>,
  )
}
const term = (name: string) => screen.getByRole('button', { name })
const hover = (el: HTMLElement) => fireEvent.pointerEnter(el, { pointerType: 'mouse' })

describe('Glossary tooltip (D8, K7, §4 row 20)', () => {
  it('opens on focus at once, describes the term and links to the Methodology anchor', () => {
    renderTerms()
    act(() => term('health').focus())
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe(
      'One score from 0 to 100, built from four parts. How it is measured',
    )
    expect(term('health').getAttribute('aria-describedby')).toBe(tip.id)
    expect(screen.getByRole('link', { name: 'How it is measured' }).getAttribute('href')).toBe(
      '/methodology#health',
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('waits 600 ms on mouse hover, closes in 0 ms, and opens the next term instantly within 400 ms', () => {
    renderTerms()
    hover(term('health'))
    act(() => vi.advanceTimersByTime(599))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip').textContent).toContain('One score')
    fireEvent.pointerLeave(term('health'), { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
    hover(term('bps'))
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByRole('tooltip').textContent).toContain('Basis points')
  })

  it('ignores touch hover and opens on a tap instead', () => {
    renderTerms()
    fireEvent.pointerEnter(term('bps'), { pointerType: 'touch' })
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(term('bps'), { detail: 1 })
    expect(screen.getByRole('tooltip').textContent).toContain('Basis points')
    // Only one definition is open at a time.
    act(() => term('health').focus())
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip').textContent).toContain('One score')
  })
})

describe('popover placement (§5.10)', () => {
  it('sits 8 px under its trigger, aligned to the nearer edge, 8 px inside the viewport', () => {
    // A trigger near the right edge: right-aligned.
    expect(placePopover({ left: 1180, right: 1320, bottom: 74, width: 140 }, 240, 1440)).toEqual({
      left: 1080,
      top: 82,
      origin: '170px top',
    })
    // A trigger on the left half: left-aligned.
    expect(placePopover({ left: 344, right: 437, bottom: 24, width: 93 }, 260, 1440).left).toBe(344)
    // A phone: clamped 8 px from the edge.
    expect(placePopover({ left: 330, right: 374, bottom: 80, width: 44 }, 320, 390).left).toBe(54)
    expect(placePopover({ left: 0, right: 30, bottom: 20, width: 30 }, 320, 320).left).toBe(8)
  })
})
