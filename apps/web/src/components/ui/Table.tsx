/**
 * Table parts (docs/design/visual-v4.md §5.8): the sortable header cell and the pool cell. Header
 * cells are 13 px / 650 `--text-2` in sentence case; sortable ones are buttons, and the sorted
 * column is `--text-1` with a 12 px arrow before its label (so a right-aligned label ends over its
 * numbers) and carries `aria-sort`; other arrows show at 0.6 on hover. The pool cell is the pair at
 * 17 px / 750, then "Uniswap v3, 0.05 %" at 13 px; its link is the row's one tab stop, stretched
 * over the row (`row-link` in tables, `rl-link` in row lists), and is named by both lines
 * ("WETH / USDC, Uniswap v3, 0.05 %"), so a list of links never repeats a bare pair.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { pairLabel, poolDesc, poolHref } from '../../lib/format.js'
import { Icon } from './Icon.js'

export type SortDir = 'asc' | 'desc'

export function SortHeader({
  label,
  active,
  dir,
  onSort,
  align = 'right',
  note,
}: {
  label: string
  /** This column is the current sort. */
  active: boolean
  dir: SortDir
  onSort: () => void
  align?: 'left' | 'right'
  /** After the button: why the column shows "—" (`UnknownNote`); the header keeps its name. */
  note?: ReactNode
}) {
  const showDir: SortDir = active ? dir : 'desc'
  return (
    <th
      scope="col"
      aria-label={label}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={align === 'left' ? { textAlign: 'left' } : undefined}
    >
      <button type="button" className="sort-btn" onClick={onSort}>
        <Icon name={showDir === 'asc' ? 'arrowUp' : 'arrowDown'} size={12} />
        {label}
      </button>
      {note}
    </th>
  )
}

export interface PoolCellPool {
  id: string
  dex: string
  feePips: number
  stable?: boolean
  token0: { symbol: string }
  token1: { symbol: string }
}

export function PoolCell({
  pool,
  linkClass = 'rl-link',
  label,
  tieBreak,
}: {
  pool: PoolCellPool
  /** `row-link` inside the pools table, `rl-link` inside row lists. */
  linkClass?: 'row-link' | 'rl-link'
  /** The link's accessible name when it should say more than the pair and its second line. */
  label?: string
  /** What tells this pool from a same-named one in the list (`poolTieBreaks`). */
  tieBreak?: string
}) {
  const pair = pairLabel(pool.token0, pool.token1)
  const desc = poolDesc(pool, tieBreak)
  return (
    <div className="cell-pool">
      <Link
        className={`pp ${linkClass}`}
        to={poolHref(pool.id)}
        aria-label={label ?? `${pair}, ${desc}`}
      >
        {pair}
      </Link>
      {/* The link's name already says it. */}
      <span className="pd" aria-hidden="true">
        {desc}
      </span>
    </div>
  )
}
