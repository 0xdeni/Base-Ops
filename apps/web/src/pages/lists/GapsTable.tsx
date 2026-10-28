/**
 * The Gaps table view (`view=table`, ia-v3 §4.4, L2, docs/design/visual-v4.md §6.5): a table sheet
 * over the band with every v2 column, pool, 24 h volume, depth ±2 %, turnover, gap score, health and
 * TVL, each sortable (`sort`, `dir` in the URL) under a sticky header. On phones it scrolls inside
 * its own wrapper with a sticky first column, and the page's metric (turnover, gap score) comes
 * right after the pool (TB7).
 */
import type { GapItem, SortDir } from '../../api/types.js'
import { HealthCell } from '../../components/ui/PoolCells.js'
import { PoolCell, SortHeader } from '../../components/ui/Table.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { ratio, score, usd } from '../../lib/format.js'
import { tvlReason, UNKNOWN_REASON } from '../../lib/poolsTable.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { GAPS_SORT_LABEL, type GapsSortKey, sortGaps } from './gapsModel.js'

const COLUMNS: readonly GapsSortKey[] = ['volume', 'depth', 'turnover', 'gap', 'health', 'tvl']
/** Phones see the page's own metric first, right after the sticky pool column (TB7). */
const PHONE_COLUMNS: readonly GapsSortKey[] = [
  'turnover',
  'gap',
  'volume',
  'depth',
  'health',
  'tvl',
]

function Cell({ g, k }: { g: GapItem; k: GapsSortKey }) {
  switch (k) {
    case 'volume':
      return <td>{usd(g.gap.volume24hUsd)}</td>
    case 'depth':
      return <td>{usd(g.gap.depth2Usd)}</td>
    case 'turnover':
      return <td className="lists-turnover">{ratio(g.gap.turnoverRatio)}</td>
    case 'gap':
      return (
        <td>
          {g.gap.gapScore === null ? (
            <Unknown reason={UNKNOWN_REASON.gap} />
          ) : (
            score(g.gap.gapScore)
          )}
        </td>
      )
    case 'health':
      return (
        <td>
          <HealthCell health={g.pool.health} />
        </td>
      )
    case 'tvl':
      return (
        <td>
          {g.pool.tvlUsd === null ? (
            <Unknown reason={tvlReason(g.pool.pool.dex)} />
          ) : (
            usd(g.pool.tvlUsd)
          )}
        </td>
      )
  }
}

export function GapsTable({
  items,
  sort,
  dir,
  onSort,
}: {
  items: readonly GapItem[]
  sort: GapsSortKey
  dir: SortDir
  onSort: (key: GapsSortKey) => void
}) {
  const rows = sortGaps(items, sort, dir)
  const columns = useIsPhone() ? PHONE_COLUMNS : COLUMNS
  return (
    <div className="lists-gtable-wrap">
      <table className="ptable lists-gtable">
        <caption className="sr-only">Liquidity gaps, every column</caption>
        <thead>
          <tr>
            <th scope="col">Pool</th>
            {columns.map((key) => (
              <SortHeader
                key={key}
                label={GAPS_SORT_LABEL[key]}
                active={sort === key}
                dir={dir}
                onSort={() => onSort(key)}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.pool.pool.id}>
              <td>
                <PoolCell pool={g.pool.pool} linkClass="row-link" />
              </td>
              {columns.map((k) => (
                <Cell key={k} g={g} k={k} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
