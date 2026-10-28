/**
 * The DEX filter (docs/design/visual-v4.md §5.4): on the Pools band from 840 px, a radiogroup of
 * 44 px rows, All DEXes first, then each DEX by its depth. Each row is the DEX name (15 px / 750)
 * and its share of all depth within 2 % on the right ("83 %", "under 1 %"; "100 %" for All), over a
 * 6 px bar drawn to that share on one scale. The selected row is a white block with Blue text and
 * a Blue bar. Arrow keys move the selection instantly, with a roving tab stop; each row's name reads
 * "Uniswap v3, 83 % of the depth within 2 %". Phones get the same options in the Filter sheet
 * (`dexShares` feeds both). The shares are display ratios of the API's own totals
 * (`stats.byDex[].depth2Usd` over `stats.totals.depth2Usd`).
 */
import { type KeyboardEvent, useRef } from 'react'
import type { Dex, DexStatsDto } from '../../api/types.js'
import { dexLabel, NB, shareOf } from '../../lib/format.js'
import { isKeyboardClick } from '../../lib/motion.js'

export interface DexShare {
  /** null: every DEX. */
  dex: Dex | null
  label: string
  /** Share of all depth within 2 %, 0 to 1; null when the total is not known. */
  share: number | null
}

/** All DEXes, then each DEX by its depth within 2 % (largest first; ties keep the API's order). */
export function dexShares(byDex: readonly DexStatsDto[], total: number): DexShare[] {
  const known = total > 0
  const rows = byDex
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.depth2Usd - a.d.depth2Usd || a.i - b.i)
    .map(({ d }) => ({
      dex: d.dex,
      label: dexLabel(d.dex),
      share: known ? Math.min(1, Math.max(0, d.depth2Usd / total)) : null,
    }))
  return [{ dex: null, label: 'All DEXes', share: known ? 1 : null }, ...rows]
}

/** "Uniswap v3, 83 % of the depth within 2 %": a row's accessible name. */
export function dexShareLabel(row: DexShare): string {
  return row.share === null
    ? row.label
    : `${row.label}, ${shareOf(row.share)} of the depth within 2${NB}%`
}

export function DexFilter({
  rows,
  value,
  onChange,
  label = 'DEX',
}: {
  rows: readonly DexShare[]
  /** The selected DEX; null for All DEXes. */
  value: Dex | null
  /** `keyboard` is true for arrow keys, Enter and Space: callers skip their animations. */
  onChange: (value: Dex | null, meta: { keyboard: boolean }) => void
  label?: string
}) {
  const groupRef = useRef<HTMLDivElement | null>(null)
  const selected = Math.max(
    0,
    rows.findIndex((r) => r.dex === value),
  )
  const select = (index: number, keyboard: boolean) => {
    const row = rows[index]
    if (!row || row.dex === value) return
    onChange(row.dex, { keyboard })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = rows.length
    let j = -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (index + 1) % n
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (index - 1 + n) % n
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = n - 1
    if (j < 0) return
    e.preventDefault()
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus()
    select(j, true)
  }
  return (
    <div ref={groupRef} className="dexf" role="radiogroup" aria-label={label}>
      {rows.map((row, i) => (
        // biome-ignore lint/a11y/useSemanticElements: a full-row custom radio with a share bar (§5.4)
        <button
          key={row.dex ?? 'all'}
          type="button"
          role="radio"
          className="dexf-row"
          aria-checked={i === selected}
          aria-label={dexShareLabel(row)}
          tabIndex={i === selected ? 0 : -1}
          onClick={(e) => select(i, isKeyboardClick(e))}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <b>{row.label}</b>
          <span className="num">{row.share === null ? '' : shareOf(row.share)}</span>
          <span className="dexf-bar" aria-hidden="true">
            <i style={{ width: `${((row.share ?? 0) * 100).toFixed(2)}%` }} />
          </span>
        </button>
      ))}
    </div>
  )
}
