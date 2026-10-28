/**
 * Bounded parallelism for the reader's own request fan-out: the groups of one batched multicall
 * (./multicall.ts) and the probes of a creation-block search round (../seed/createdAt.ts).
 */

/**
 * Runs `tasks` with at most `limit` in flight, starting them in order. After a failure no further
 * task starts and the error is thrown at once; tasks already running finish on their own.
 */
export async function runLimited(
  tasks: readonly (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const task = tasks[next++]
      try {
        if (task) await task()
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker))
}
