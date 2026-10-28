import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coolGlossary, Glossary, placeTooltip } from './Glossary.js'
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

describe('Glossary tooltip (§5.10, §4.4)', () => {
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

describe('placement (§5.10)', () => {
  it('sets a popover 8 px under its trigger, right-aligned to it, 16 px inside the viewport', () => {
    const at = (left: number, right: number, top: number, bottom: number) => ({
      left,
      right,
      top,
      bottom,
      width: right - left,
    })
    expect(placePopover(at(1180, 1320, 34, 74), 240, 200, 1440, 900)).toEqual({
      left: 1080,
      top: 82,
      origin: '170px top',
      maxHeight: null,
    })
    expect(placePopover(at(344, 437, 0, 24), 260, 200, 1440, 900).left).toBe(177)
    // A phone: clamped 16 px from either edge.
    expect(placePopover(at(330, 374, 36, 80), 320, 200, 390, 844).left).toBe(54)
    expect(placePopover(at(340, 380, 40, 80), 358, 200, 390, 844).left).toBe(16)
    expect(placePopover(at(0, 30, 0, 20), 288, 200, 320, 640).left).toBe(16)
  })

  it('opens above its trigger when it would end less than 16 px from the viewport bottom', () => {
    // The Columns button of the Pools band at 1440 × 900 (trigger bottom 797, popover 204 tall).
    const trigger = { left: 1240, right: 1376, top: 757, bottom: 797, width: 136 }
    expect(placePopover(trigger, 260, 204, 1440, 900)).toEqual({
      left: 1116,
      top: 757 - 8 - 204,
      origin: '192px bottom',
      maxHeight: null,
    })
    // Room on neither side: the roomier side, scrolled to fit 16 px inside the viewport.
    const mid = { left: 100, right: 200, top: 300, bottom: 340, width: 100 }
    expect(placePopover(mid, 260, 600, 1440, 700)).toMatchObject({
      top: 348,
      origin: '134px top',
      maxHeight: 700 - 16 - 348,
    })
    const low = { left: 100, right: 200, top: 500, bottom: 540, width: 100 }
    expect(placePopover(low, 260, 600, 1440, 700)).toMatchObject({
      top: 16,
      origin: '134px bottom',
      maxHeight: 500 - 8 - 16,
    })
  })

  it('sets a tooltip 10 px above its trigger, or 10 px below it near the top', () => {
    expect(placeTooltip({ left: 100, top: 200, bottom: 220, width: 40 }, 160, 60, 1440)).toEqual({
      left: 40,
      top: 130,
      below: false,
    })
    expect(placeTooltip({ left: 100, top: 40, bottom: 60, width: 40 }, 160, 60, 1440)).toEqual({
      left: 40,
      top: 70,
      below: true,
    })
  })
})
