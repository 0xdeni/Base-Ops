/**
 * "Pools" on the Token page (ia-v3 §4.7 section 1, TB1–TB7): the shared pools table, with the
 * same default columns as Pools (pool, health, depth ±2 % with its row glyph, spread at $10K, 24 h
 * volume) and the optional ones behind Columns in the section heading (the Sort sheet on phones).
 * The token's pools all fit one page, so every sort orders them here, nulls last. A refetch keeps
 * the rows and dims them (M10). Depth glyphs are on one shared scale, sides seen from this token.
 */
import type { PoolSummary } from '../../api/types.js'
import { PoolsTable } from '../../components/ui/PoolsTable.js'
import { Section } from '../../components/ui/Section.js'
import { Refetch } from '../../components/ui/States.js'
import { ColumnsMenu, SortSheet } from '../../components/ui/TableControls.js'
import {
  defaultDir,
  nextSort,
  type PoolsSortKey,
  sortPools,
  type TableState,
  updatedCaption,
} from '../../lib/poolsTable.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { poolsTakeaway } from './tokenText.js'

export function TokenPools({
  pools,
  symbol,
  state,
  busy,
  now,
  onChange,
}: {
  /** Seen from this token (sides oriented), as loaded. */
  pools: readonly PoolSummary[]
  symbol: string
  state: TableState
  busy: boolean
  now: number
  onChange: (next: TableState) => void
}) {
  const phone = useIsPhone()
  const { sort, dir, cols } = state
  const rows = sortPools(pools, sort, dir)
  const onSort = (key: PoolsSortKey) => onChange({ ...state, ...nextSort(state, key) })
  const controls = phone ? (
    <SortSheet
      sort={sort}
      dir={dir}
      onSort={(key) => onChange({ ...state, sort: key, dir: defaultDir(key) })}
      onDir={(d) => onChange({ ...state, dir: d })}
    />
  ) : (
    <ColumnsMenu
      cols={cols}
      onChange={(next) => onChange({ ...state, cols: next })}
      className="token-cols"
    />
  )
  return (
    <Section
      id="s-pools"
      title="Pools"
      takeaway={poolsTakeaway(pools, symbol)}
      controls={controls}
      className="token-sec-pools"
    >
      <div className="tbl-caption token-caption">
        <span aria-live="polite">
          {pools.length} {pools.length === 1 ? 'pool' : 'pools'}
        </span>
        <span>{updatedCaption(pools, now)}</span>
      </div>
      <Refetch busy={busy}>
        <PoolsTable
          rows={rows}
          state={state}
          now={now}
          phone={phone}
          onSort={onSort}
          label={`Pools containing ${symbol}`}
        />
      </Refetch>
    </Section>
  )
}
