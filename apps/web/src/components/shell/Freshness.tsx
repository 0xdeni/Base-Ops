/**
 * Data freshness (ia-v3 §3.2, docs/design/visual-v3.md §5.1): a button with a 6 px `ok` dot and
 * "Updated 2 min ago" (the dot alone, as a 44 px target, on phones). Its popover lists Updated,
 * Block (grouped), Pools tracked and the full UTC snapshot time. When the API is unreachable it
 * reads "Offline" with a `bad` triangle, and the popover adds the error and Retry (ST7). Values
 * swap with no animation and are not announced (M8, A11). A published live snapshot (static build
 * of a `live` bundle) never updates: the button reads "As of 25 Oct, 08:14 UTC" with a hollow
 * `text-3` dot instead of the `ok` one, and its popover gives the snapshot and export times.
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
  const text = `As of ${full(at)}`
  const summary = [
    data.latestBlock ? `Block ${group(data.latestBlock)}` : null,
    `${tracked(data)} pools tracked`,
    dated(at),
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Popover
      label="Data freshness"
      triggerClassName="fresh"
      triggerLabel={`Data freshness: as of ${full(at)}`}
      triggerTitle={summary}
      trigger={
        <>
          <span className="fresh-dot is-snapshot" aria-hidden="true" />
          <span className="fresh-text">{text}</span>
        </>
      }
    >
      <dl className="pop-dl">
        <div>
          <dt>Snapshot</dt>
          <dd>{dated(at)}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd>{group(data.latestBlock)}</dd>
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

  // Booting on a slow API: the slot says so in words, with no status dot (ST1).
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
  const updated =
    data.latestSnapshotAt === null ? 'No snapshot yet' : ago(data.latestSnapshotAt, now)
  const text = data.latestSnapshotAt === null ? 'No snapshot yet' : `Updated ${updated}`
  const summary = [
    data.latestBlock ? `Block ${group(data.latestBlock)}` : null,
    `${tracked(data)} pools tracked`,
    data.latestSnapshotAt === null ? null : full(data.latestSnapshotAt),
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Popover
      label="Data freshness"
      triggerClassName="fresh"
      triggerLabel={`Data freshness: ${text.charAt(0).toLowerCase()}${text.slice(1)}`}
      triggerTitle={summary}
      trigger={
        <>
          <span className="fresh-dot" aria-hidden="true" />
          <span className="fresh-text">{text}</span>
        </>
      }
    >
      <dl className="pop-dl">
        <div>
          <dt>Updated</dt>
          <dd>{updated}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd>{group(data.latestBlock)}</dd>
        </div>
        <div>
          <dt>Pools tracked</dt>
          <dd>{tracked(data)}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{full(data.latestSnapshotAt)}</dd>
        </div>
      </dl>
    </Popover>
  )
}
