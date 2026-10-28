/**
 * "mandates on this pool" (ia-v3 §4.3 section 5, docs/design/visual-v4.md §6.4): the last row of
 * the sections sheet, shown only when market makers have mandates on the pool, one shared mandate
 * row each (status word, name, who and where, 7 d uptime bullet).
 */
import { useScorecards } from '../../api/hooks.js'
import type { PoolMetaDto } from '../../api/types.js'
import { MandateRow } from '../../components/ui/MandateRow.js'
import { Section } from '../../components/ui/Section.js'
import { pairLabel } from '../../lib/format.js'

export function PoolMandates({ pool }: { pool: PoolMetaDto }) {
  const mandates = useScorecards({ pool: pool.id })
  const items = (mandates.data?.items ?? []).filter((s) => s.mandate.poolId === pool.id)
  if (!items.length) return null
  const ok = items.filter((s) => s.status === 'ok').length
  return (
    <Section
      id="s-mm"
      title="mandates on this pool"
      takeaway={`${ok} of ${items.length} within KPI right now.`}
      className="pool-sec-mm"
    >
      <ol className="rowlist is-ruled">
        {items.map((s) => (
          <MandateRow key={s.mandate.id} summary={s} where={pairLabel(pool.token0, pool.token1)} />
        ))}
      </ol>
    </Section>
  )
}
