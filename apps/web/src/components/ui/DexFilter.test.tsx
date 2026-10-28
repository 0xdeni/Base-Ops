/**
 * The DEX filter (docs/design/visual-v4.md §5.4): a radiogroup of rows, All DEXes first and each
 * DEX by its depth, its share of all depth within 2 % in the name and as a bar on one scale; arrow
 * keys move the selection instantly.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Dex, DexStatsDto } from '../../api/types.js'
import { DexFilter, dexShares } from './DexFilter.js'

afterEach(cleanup)

const stat = (dex: Dex, depth2Usd: number): DexStatsDto => ({
  dex,
  pools: 1,
  tracked: 1,
  scored: 1,
  rated: 1,
  depth2Usd,
  depthKnownPools: 1,
  volume24hUsd: null,
  medianHealth: null,
})
// The 25 Oct 2026 snapshot: $49.9M within 2 %, 83 %, 13 %, 3 % and under 1 % by DEX.
const BY_DEX = [
  stat('uniswap-v3', 41_400_000),
  stat('uniswap-v4', 1_500_000),
  stat('aerodrome-v2', 300_000),
  stat('aerodrome-slipstream', 6_700_000),
]
const TOTAL = 49_900_000

function Harness({ onChange }: { onChange: (v: Dex | null, m: { keyboard: boolean }) => void }) {
  const [value, setValue] = useState<Dex | null>(null)
  return (
    <DexFilter
      rows={dexShares(BY_DEX, TOTAL)}
      value={value}
      onChange={(v, meta) => {
        onChange(v, meta)
        setValue(v)
      }}
    />
  )
}

describe('DexFilter (§5.4)', () => {
  it('lists All DEXes, then each DEX by its share of all depth within 2 %', () => {
    const rows = dexShares(BY_DEX, TOTAL)
    expect(rows.map((r) => r.label)).toEqual([
      'All DEXes',
      'Uniswap v3',
      'Aerodrome Slipstream',
      'Uniswap v4',
      'Aerodrome v2',
    ])
    expect(rows[0]?.share).toBe(1)
    expect(rows.slice(1).reduce((sum, r) => sum + (r.share ?? 0), 0)).toBeCloseTo(1, 6)
    expect(dexShares(BY_DEX, 0).every((r) => r.share === null)).toBe(true)
  })

  it('is a radiogroup whose rows name their share and draw it on one scale', () => {
    render(<Harness onChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'DEX' })
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'All DEXes, 100 % of the depth within 2 %',
      'Uniswap v3, 83 % of the depth within 2 %',
      'Aerodrome Slipstream, 13 % of the depth within 2 %',
      'Uniswap v4, 3 % of the depth within 2 %',
      'Aerodrome v2, under 1 % of the depth within 2 %',
    ])
    expect(radios.map((r) => r.querySelector('.num')?.textContent)).toEqual([
      '100 %',
      '83 %',
      '13 %',
      '3 %',
      'under 1 %',
    ])
    const widths = radios.map((r) => (r.querySelector('.dexf-bar i') as HTMLElement).style.width)
    expect(widths).toEqual(['100%', '82.97%', '13.43%', '3.01%', '0.6%'])
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1])
    expect(group.className).toBe('dexf')
  })

  it('names all six DEXes apart, the Aero venues beside the Aerodrome ones', () => {
    const six = [...BY_DEX, stat('aero-v2', 1_200_000), stat('aero-slipstream', 9_800_000)]
    const rows = dexShares(six, 60_900_000)
    expect(rows).toHaveLength(7)
    expect(rows.map((r) => r.label)).toEqual([
      'All DEXes',
      'Uniswap v3',
      'Aero Slipstream',
      'Aerodrome Slipstream',
      'Uniswap v4',
      'Aero v2',
      'Aerodrome v2',
    ])
    render(<DexFilter rows={rows} value="aero-slipstream" onChange={() => {}} />)
    const checked = screen
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Aero Slipstream, 16 % of the depth within 2 %',
    ])
  })

  it('moves the selection with the arrow keys, Home and End, flagged as keyboard', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const radio = (i: number) => screen.getAllByRole('radio')[i] as HTMLElement
    fireEvent.keyDown(radio(0), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('uniswap-v3', { keyboard: true })
    expect(document.activeElement).toBe(radio(1))
    expect(radio(1).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radio(1), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('aerodrome-v2', { keyboard: true })
    fireEvent.keyDown(radio(4), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(null, { keyboard: true })
    fireEvent.click(radio(2), { detail: 1 })
    expect(onChange).toHaveBeenLastCalledWith('aerodrome-slipstream', { keyboard: false })
    // Choosing the selected row again is not a change.
    fireEvent.click(radio(2), { detail: 1 })
    expect(onChange).toHaveBeenCalledTimes(4)
  })
})
