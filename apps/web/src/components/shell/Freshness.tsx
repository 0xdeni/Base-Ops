/**
 * Data freshness (docs/design/visual-v4.md §5.1, ia-v3 §3.2): pushed to the right of the app bar,
 * an 8 px Green circle and the eyebrow "Block 53,069,244" in a 40 px button (the dot alone, as a
 * 44 × 44 target, on phones). Never a square. Its popover gives the snapshot time, the block and
 * "492 of 580" pools tracked. Live data says how long ago it was updated in the button's name and
 * the popover; a published snapshot gives its absolute time instead, never "… ago". When the API is
 * unreachable it reads "Offline" with a Red triangle, and the popover adds the error and Retry.
 * Values swap with no animation and are not announced.
 */
import { useDataNow, useIsConnecting, useSnapshot } from '../../api/context.js'
import { errorText } from '../../api/errors.js'
import { useHealth } from '../../api/hooks.js'
import type { HealthResponse } from '../../api/types.js'
import { ago, count, dated, full, group } from '../../lib/format.js'
import { Button } from '../ui/Button.js'
import { Popover } from '../ui/Popover.js'

function tracked(data: HealthResponse): string {
  return `${count(data.trackedCount)} of ${count(data.poolCount)}`
}

/** "Block 53,069,244, 492 of 580 pools tracked, 25 Oct 2026, 11:30 UTC" (the native tooltip). */
function summary(data: HealthResponse, at: number | null): string {
  return [
    data.latestBlock ? `Block ${group(data.latestBlock)}` : null,
    `${tracked(data)} pools tracked`,
    at === null ? null : dated(at),
  ]
    .filter(Boolean)
    .join(', ')
}

/** The trigger: the circle and the block as an eyebrow, or the words before any snapshot. */
function BlockTrigger({ data, snapshot }: { data: HealthResponse; snapshot?: boolean }) {
  return (
    <>
      <span className={`fresh-dot${snapshot ? ' is-snapshot' : ''}`} aria-hidden="true" />
      {data.latestBlock ? (
        <span className="eyebrow fresh-text">Block {group(data.latestBlock)}</span>
      ) : (
        <span className="fresh-text">No snapshot yet</span>
      )}
    </>
  )
}

/** The freshness of a published snapshot: its absolute time, never "… ago". */
function SnapshotFreshness({
  data,
  at,
  exportedAt,
}: {
  data: HealthResponse
  at: number
  exportedAt: number
}) {
  return (
    <Popover
      label="Data freshness"
      triggerClassName="fresh"
      triggerLabel={`Data freshness: as of ${full(at)}`}
      triggerTitle={summary(data, at)}
      trigger={<BlockTrigger data={data} snapshot />}
    >
      <p className="eyebrow">Snapshot</p>
      <dl className="pop-dl">
        <div>
          <dt>Snapshot</dt>
          <dd>{dated(at)}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd className="mono">{group(data.latestBlock)}</dd>
        </div>
        <div>
          <dt>Pools tracked</dt>
          <dd>{tracked(data)}</dd>
        </div>
        <div>
          <dt>Exported</dt>
          <dd>{dated(exportedAt)}</dd>
        </div>
      </dl>
      <p className="small t2">This page does not update.</p>
    </Popover>
  )
}

export function Freshness() {
  const health = useHealth()
  const now = useDataNow()
  const snapshot = useSnapshot()
  const connecting = useIsConnecting()
  const data = health.data
  const offline = health.isError || (data !== undefined && !data.ok)

  // Booting on a slow API: the slot says so in words, with no status dot.
  if (!data && !health.isError && connecting)
    return <span className="fresh is-connecting">Connecting…</span>
  if (!data && !health.isError) return <span className="fresh" aria-hidden="true" />

  if (snapshot && data && !offline)
    return <SnapshotFreshness data={data} at={snapshot.at} exportedAt={snapshot.exportedAt} />

  if (offline) {
    const reason = health.isError
      ? errorText(health.error)
      : (data?.error ?? 'The API reports a problem.')
    return (
      <Popover
        label="Data freshness"
        triggerClassName="fresh is-offline"
        triggerLabel="Data freshness: offline"
        trigger={
          <>
            <svg className="fresh-off" viewBox="0 0 8 8" aria-hidden="true">
              <path d="M4 .5L7.8 7.5H.2z" fill="currentColor" />
            </svg>
            <span className="fresh-text">Offline</span>
          </>
        }
      >
        <p>Unable to reach the API: {reason}</p>
        <div className="pop-actions">
          <Button onClick={() => void health.refetch()} loading={health.isFetching}>
            Retry
          </Button>
        </div>
      </Popover>
    )
  }

  if (!data) return null
  const at = data.latestSnapshotAt
  const updated = at === null ? 'No snapshot yet' : ago(at, now)
  const text = at === null ? 'No snapshot yet' : `Updated ${updated}`
  return (
    <Popover
      label="Data freshness"
      triggerClassName="fresh"
      triggerLabel={`Data freshness: ${text.charAt(0).toLowerCase()}${text.slice(1)}`}
      triggerTitle={summary(data, at)}
      trigger={<BlockTrigger data={data} />}
    >
      <dl className="pop-dl">
        <div>
          <dt>Updated</dt>
          <dd>{updated}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd className="mono">{group(data.latestBlock)}</dd>
        </div>
        <div>
          <dt>Pools tracked</dt>
          <dd>{tracked(data)}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{full(at)}</dd>
        </div>
      </dl>
    </Popover>
  )
}
