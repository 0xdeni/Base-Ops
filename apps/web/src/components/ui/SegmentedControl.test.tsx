import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl.js'

afterEach(cleanup)

const WINDOWS = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
  { value: '30d', label: '30 d' },
] as const
type Win = (typeof WINDOWS)[number]['value']

function Harness({ onChange }: { onChange: (v: Win, meta: { keyboard: boolean }) => void }) {
  const [value, setValue] = useState<Win>('7d')
  return (
    <SegmentedControl
      label="Time window"
      options={WINDOWS}
      value={value}
      onChange={(v, meta) => {
        onChange(v, meta)
        setValue(v)
      }}
    />
  )
}

const radio = (name: string) => screen.getByRole('radio', { name })

describe('SegmentedControl (§5.4)', () => {
  it('is a labelled radiogroup with a roving tab stop on the selected item', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Time window' })).toBeTruthy()
    expect(radio('7 d').getAttribute('aria-checked')).toBe('true')
    expect(WINDOWS.map((w) => radio(w.label).tabIndex)).toEqual([-1, 0, -1])
  })

  it('moves the selection and focus with the arrow keys, Home and End, flagged as keyboard', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(radio('7 d'), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('30d', { keyboard: true })
    expect(document.activeElement).toBe(radio('30 d'))
    expect(radio('30 d').tabIndex).toBe(0)
    fireEvent.keyDown(radio('30 d'), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('24h', { keyboard: true })
    fireEvent.keyDown(radio('24 h'), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('30d', { keyboard: true })
    fireEvent.keyDown(radio('30 d'), { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('24h', { keyboard: true })
    fireEvent.keyDown(radio('24 h'), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('30d', { keyboard: true })
  })

  it('tells pointer clicks from Enter and Space (detail 0) apart', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(radio('24 h'), { detail: 1 })
    expect(onChange).toHaveBeenLastCalledWith('24h', { keyboard: false })
    fireEvent.click(radio('30 d'), { detail: 0 })
    expect(onChange).toHaveBeenLastCalledWith('30d', { keyboard: true })
    // Choosing the selected item again is not a change.
    fireEvent.click(radio('30 d'), { detail: 1 })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('has a band variant', () => {
    render(
      <SegmentedControl
        label="Rating"
        onBand
        options={[
          { value: 'all', label: 'All pools' },
          { value: 'rated', label: 'Rated only' },
        ]}
        value="all"
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Rating' }).className).toBe('seg is-band')
  })

  it('clips the thumb to the selected item and moves it instantly after a keyboard change', () => {
    const { container } = render(<Harness onChange={() => {}} />)
    const thumb = container.querySelector('.seg-thumb') as HTMLElement
    expect(thumb.getAttribute('aria-hidden')).toBe('true')
    expect(thumb.style.getPropertyValue('--l')).toMatch(/px$/)
    expect(thumb.style.getPropertyValue('--r')).toMatch(/px$/)
    fireEvent.keyDown(radio('7 d'), { key: 'ArrowRight' })
    expect(screen.getByRole('radiogroup').hasAttribute('data-instant')).toBe(true)
  })
})
