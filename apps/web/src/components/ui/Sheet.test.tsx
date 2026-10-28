import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl.js'
import { Sheet, SheetOptions } from './Sheet.js'

afterEach(cleanup)

const SORTS = [
  { value: 'health', label: 'Health' },
  { value: 'depth', label: 'Depth ±2 %' },
  { value: 'volume', label: '24 h volume' },
] as const
type Sort = (typeof SORTS)[number]['value']

function Harness({ onSort = () => {} }: { onSort?: (s: Sort) => void }) {
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<Sort>('depth')
  const [dir, setDir] = useState<'desc' | 'asc'>('desc')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Sort: depth
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Sort pools"
        instant
        foot={
          <SegmentedControl
            label="Order"
            full
            options={[
              { value: 'desc', label: 'Highest first' },
              { value: 'asc', label: 'Lowest first' },
            ]}
            value={dir}
            onChange={setDir}
          />
        }
      >
        <SheetOptions
          label="Sort by"
          options={SORTS}
          value={sort}
          onChange={(s) => {
            onSort(s)
            setSort(s)
          }}
        />
      </Sheet>
    </>
  )
}

function openSheet() {
  const trigger = screen.getByRole('button', { name: 'Sort: depth' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('Sheet (§5.10)', () => {
  it('is a labelled modal dialog that focuses the selected option and locks the body', () => {
    render(<Harness />)
    openSheet()
    const dialog = screen.getByRole('dialog', { name: 'Sort pools' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Depth ±2 %' }))
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('radiogroup', { name: 'Order' })).toBeTruthy()
  })

  it('ends on a full-width primary Done, and traps focus between it and the first option', () => {
    render(<Harness />)
    openSheet()
    const dialog = screen.getByRole('dialog')
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done.className).toBe('btn primary')
    expect(done.parentElement?.className).toBe('sheet-done')
    expect(dialog.lastElementChild).toBe(done.parentElement)
    const first = screen.getByRole('radio', { name: 'Depth ±2 %' })
    done.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(done)
  })

  it('closes on Escape and on Done, returning focus and unlocking the body', () => {
    render(<Harness />)
    const trigger = openSheet()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
    openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('selects options with a check and the arrow keys', () => {
    const onSort = vi.fn()
    render(<Harness onSort={onSort} />)
    openSheet()
    fireEvent.click(screen.getByRole('radio', { name: 'Health' }))
    expect(onSort).toHaveBeenLastCalledWith('health')
    expect(screen.getByRole('radio', { name: 'Health' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Health' }), { key: 'ArrowDown' })
    expect(onSort).toHaveBeenLastCalledWith('depth')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Depth ±2 %' }))
  })
})
