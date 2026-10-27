/**
 * "Compare DEXes" (ia-v3 §4.2, L2): a disclosure 48 px below the table holding every
 * `StatsResponse.byDex` field per DEX, deepest first, with an "All DEXes" totals row: pools scored,
 * rated, tracked and discovered, depth ±2 %, 24 h volume and median health (over rated pools) with
 * its grade.
 */
import { healthGrade } from '@depthwatch/core'
import type { DexStatsDto, StatsResponse } from '../../api/types.js'
import { Disclosure } from '../../components/ui/Disclosure.js'
import { GradeGlyph } from '../../components/ui/GradeGlyph.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { count, dexLabel, NB, score, usd } from '../../lib/format.js'

function MedianHealth({ value }: { value: number | null }) {
  if (value === null) return <Unknown reason="No pool on this DEX is rated yet." />
  return (
    <span className="td-health">
      <GradeGlyph grade={healthGrade(value)} />
      <span className="n">{score(value)}</span>
    </span>
  )
}

function Row({
  name,
  row,
  total,
}: {
  name: string
  row: Omit<DexStatsDto, 'dex'>
  total?: boolean
}) {
  const Cell = total ? 'th' : 'td'
  return (
    <tr className={total ? 'tot-row' : undefined}>
      <Cell scope="row" className="lists-dex-name">
        {name}
      </Cell>
      <td className="r">{count(row.scored)}</td>
      <td className="r">{count(row.rated)}</td>
      <td className="r">{count(row.tracked)}</td>
      <td className="r">{count(row.pools)}</td>
      <td className="r">{usd(row.depth2Usd)}</td>
      <td className="r">{usd(row.volume24hUsd)}</td>
      <td className="r">
        <MedianHealth value={row.medianHealth} />
      </td>
    </tr>
  )
}

export function CompareDexes({ stats }: { stats: StatsResponse }) {
  const rows = [...stats.byDex].sort((a, b) => b.depth2Usd - a.depth2Usd)
  return (
    <Disclosure label="Compare DEXes" className="lists-compare">
      <TableScroll>
        <table className="tbl dense lists-dex-table">
          <caption className="sr-only">Pools, depth and health per DEX</caption>
          <thead>
            <tr>
              <th scope="col">DEX</th>
              <th scope="col" className="r">
                Scored
              </th>
              <th scope="col" className="r">
                Rated
              </th>
              <th scope="col" className="r">
                Tracked
              </th>
              <th scope="col" className="r">
                Discovered
              </th>
              <th scope="col" className="r">
                Depth ±2{NB}%
              </th>
              <th scope="col" className="r">
                24{NB}h volume
              </th>
              <th scope="col" className="r">
                Median health
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.dex} name={dexLabel(r.dex)} row={r} />
            ))}
            <Row name="All DEXes" row={stats.totals} total />
          </tbody>
        </table>
      </TableScroll>
    </Disclosure>
  )
}
