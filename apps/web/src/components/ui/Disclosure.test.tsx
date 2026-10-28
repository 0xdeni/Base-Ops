import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EASE } from '../../lib/motion.js'
import { Disclosure } from './Disclosure.js'
import { AboutSection, Section, SectionsSheet } from './Section.js'

type Call = {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  anim: { onfinish: null | (() => void) }
}
let calls: Call[]

beforeEach(() => {
  calls = []
  // A WAAPI stand-in: records each animation; `finish()` runs its onfinish.
  Element.prototype.animate = function animate(keyframes, options) {
    const anim = { onfinish: null as null | (() => void), cancel() {} }
    calls.push({
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
      anim,
    })
    return anim as unknown as Animation
  }
  Element.prototype.getAnimations = () => []
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(Element.prototype, 'animate')
  Reflect.deleteProperty(Element.prototype, 'getAnimations')
  Reflect.deleteProperty(window, 'matchMedia')
})

const trigger = () => screen.getByRole('button')

describe('Disclosure (§5.3, §4.4)', () => {
  it('is a button with aria-expanded and aria-controls; its panel follows it in the DOM', () => {
    render(<Disclosure label="Show data">numbers</Disclosure>)
    const btn = trigger()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    const panel = document.getElementById(btn.getAttribute('aria-controls') ?? '')
    expect(panel?.hidden).toBe(true)
    expect(screen.queryByText('numbers')).toBeNull()
    expect(
      btn.compareDocumentPosition(panel as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    fireEvent.click(btn, { detail: 1 })
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.hidden).toBe(false)
    expect(screen.getByText('numbers')).toBeTruthy()
  })

  it('fades in and settles from -8 px over 200 ms --ease-out for a pointer; closes at once', () => {
    render(<Disclosure label="Details">rows</Disclosure>)
    fireEvent.click(trigger(), { detail: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options).toMatchObject({ duration: 200, easing: EASE.out })
    expect(calls[0]?.keyframes).toEqual([
      { opacity: 0, transform: 'translateY(-8px)' },
      { opacity: 1, transform: 'none' },
    ])
    fireEvent.click(trigger(), { detail: 1 })
    expect(calls).toHaveLength(1)
    expect(screen.queryByText('rows')).toBeNull()
  })

  it('never animates a keyboard toggle (M2)', () => {
    render(<Disclosure label="Details">rows</Disclosure>)
    fireEvent.click(trigger(), { detail: 0 })
    expect(screen.getByText('rows')).toBeTruthy()
    fireEvent.click(trigger(), { detail: 0 })
    expect(screen.queryByText('rows')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('keeps only the opacity under reduced motion (M9)', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }),
    })
    render(<Disclosure label="Details">rows</Disclosure>)
    fireEvent.click(trigger(), { detail: 1 })
    expect(calls[0]?.keyframes.map((k) => Object.keys(k))).toEqual([['opacity'], ['opacity']])
  })

  it('swaps a toggled label ("Show all 6 episodes" / "Show fewer")', () => {
    render(
      <Disclosure label="Show all 6 episodes" openLabel="Show fewer">
        rows
      </Disclosure>,
    )
    expect(trigger().textContent).toBe('Show all 6 episodes')
    fireEvent.click(trigger(), { detail: 0 })
    expect(trigger().textContent).toBe('Show fewer')
  })

  it('keeps a phone-only list mounted while closed (always open from 840 px)', () => {
    const { container } = render(
      <Disclosure label="About this pool" phoneOnly>
        <dl className="about" />
      </Disclosure>,
    )
    expect(container.firstElementChild?.className).toBe('ph-disc')
    expect(container.querySelector('.disc-panel[hidden] dl.about')).toBeTruthy()
  })
})

describe('the sections sheet (§5.7)', () => {
  it('puts the Details trigger in the heading and opens its panel under the visual', () => {
    render(
      <Section
        id="health"
        title="Health"
        takeaway="Concentration is the weak part."
        details={{ content: <table aria-label="Components" /> }}
      >
        <div data-testid="visual" />
      </Section>,
    )
    const section = screen.getByRole('region', { name: 'Health' })
    const head = section.querySelector('.sec-head') as HTMLElement
    const details = within(head).getByRole('button', { name: 'Details' })
    expect(within(head).getByText('Concentration is the weak part.')).toBeTruthy()
    fireEvent.click(details, { detail: 0 })
    const body = section.querySelector('.sec-body') as HTMLElement
    const table = within(body).getByRole('table', { name: 'Components' })
    expect(
      screen.getByTestId('visual').compareDocumentPosition(table) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('sets the sections as rows of one sheet', () => {
    render(
      <SectionsSheet>
        <Section id="a" title="health">
          <div />
        </Section>
        <Section id="b" title="cost to trade">
          <div />
        </Section>
      </SectionsSheet>,
    )
    const sheet = document.querySelector('.secs') as HTMLElement
    expect([...sheet.children].map((c) => c.className)).toEqual(['sec', 'sec'])
    expect(sheet.getAttribute('role')).toBeNull()
  })

  it('makes the About list a panel after the sheet, and a phone disclosure named after it', () => {
    render(
      <AboutSection id="about" title="About this pool">
        <dl className="about">
          <div>
            <dt>Fee</dt>
            <dd>0.05 %</dd>
          </div>
        </dl>
      </AboutSection>,
    )
    const section = screen.getByRole('region', { name: 'About this pool' })
    expect(section.className).toBe('blk blk--panel sec-about is-about')
    expect(within(section).getByRole('button', { name: 'About this pool' })).toBeTruthy()
    expect(within(section).getByText('Fee')).toBeTruthy()
  })
})
