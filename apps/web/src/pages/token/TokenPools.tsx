/**
 * "pools" on the Token page (ia-v3 §4.7 section 1, docs/design/visual-v4.md §6.8, §5.8): the
 * token's pools in a plane-1 table sheet after the facts. Its head holds the lowercase heading,
 * the finding (the deepest pool's share of the token's depth) and Columns (the Sort sheet on
 * phones); then the caption row and the shared pools table with the same default columns as
 * Pools. The token's pools all fit one page, so every sort orders them here, nulls last; the sheet
 * lists the first 10 and "Show all 140 pools" lists the rest (`rows=all`), a toggle that stays
 * where it was pressed. A refetch keeps the rows and dims them (M10). Depth glyphs are on one
 * shared scale, sides seen from this token.
 */
import type { PoolSummary } from '../../api/types.js'
import { Button } from '../../components/ui/Button.js'
import { PoolsTable } from '../../components/ui/PoolsTable.js'
import { Refetch } from '../../components/ui/States.js'
import { ColumnsMenu, SortSheet } from '../../components/ui/TableControls.js'
import { count } from '../../lib/format.js'
import {
  defaultDir,
  hasTopShare,
  nextSort,
  type PoolsSortKey,
  sortPools,
  type TableState,
  updatedCaption,
} from '../../lib/poolsTable.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { TOKEN_ROWS } from './tokenSort.js'
import { poolsTakeaway } from './tokenText.js'

const poolsWord = (n: number) => `${count(n)} ${n === 1 ? 'pool' : 'pools'}`

export function TokenPools({
  pools,
  symbol,
  state,
  allRows,
  busy,
  now,
  onChange,
  onAllRows,
}: {
  /** Seen from this token (sides oriented), as loaded. */
  pools: readonly PoolSummary[]
  symbol: string
  state: TableState
  /** Every pool is listed (`rows=all`). */
  allRows: boolean
  busy: boolean
  now: number
  onChange: (next: TableState) => void
  onAllRows: (all: boolean) => void
}) {
  const phone = useIsPhone()
  const { sort, dir, cols } = state
  const sorted = sortPools(pools, sort, dir)
  const paged = sorted.length > TOKEN_ROWS
  const rows = paged && !allRows ? sorted.slice(0, TOKEN_ROWS) : sorted
  const onSort = (key: PoolsSortKey) => onChange({ ...state, ...nextSort(state, key) })
  const topShare = hasTopShare(pools)
  const controls = phone ? (
    <SortSheet
      sort={sort}
      dir={dir}
      onSort={(key) => onChange({ ...state, sort: key, dir: defaultDir(key) })}
      onDir={(d) => onChange({ ...state, dir: d })}
      topShare={topShare}
    />
  ) : (
    <ColumnsMenu
      cols={cols}
      onChange={(next) => onChange({ ...state, cols: next })}
      topShare={topShare}
    />
  )
  return (
    <section className="wrap token-pools" aria-labelledby="s-pools">
      <div className="blk blk--flush token-sheet">
        <div className="token-sheet-head">
          <h2 className="h2" id="s-pools">
            pools
          </h2>
          <p className="takeaway">{poolsTakeaway(pools, symbol)}</p>
          <div className="token-sheet-ctl">{controls}</div>
        </div>
        <div className="tbl-caption">
          <span aria-live="polite">
            {rows.length < pools.length
              ? `${count(rows.length)} of ${poolsWord(pools.length)}`
              : poolsWord(pools.length)}
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
        {paged ? (
          <div className="tbl-foot">
            <Button aria-expanded={allRows} onClick={() => onAllRows(!allRows)}>
              {allRows ? `Show the first ${TOKEN_ROWS}` : `Show all ${poolsWord(pools.length)}`}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
