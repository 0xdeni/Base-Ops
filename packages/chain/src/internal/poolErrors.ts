/**
 * `PoolConfigChangedError`: a pool, or its factory, is no longer configured the way Depthwatch
 * reviewed it (docs/research/base-contracts.md, `## aero`), so its fee or depth would be modelled
 * on code that was never read. Thrown by the reads that check it:
 *
 * - `fee module changed (0x…)`: an Aero v2 factory's `feeModule()` is not its pinned
 *   CustomFeeModule (`aeroV2.volatileFeeModule` / `stableFeeModule`);
 * - `swap hook changed (0x…)`: an Aero Slipstream pool's `getPoolSwapHook` is not the hook it was
 *   discovered with (`PoolMeta.hooks`, or the deployment's reviewed `swapHook` when null);
 * - `initial fee enabled`: the reviewed hook charges the pool's first swap of each block a fixed
 *   initial fee, which `fee()` at a block without a swap does not show.
 *
 * A state read that throws it fails that pool's snapshot; a discovery or seeding read fails the
 * DEX. `depthwatch discover --seed` reads the hooks again once the change has been reviewed.
 */
export type PoolConfigChange = 'fee module changed' | 'swap hook changed' | 'initial fee enabled'

export class PoolConfigChangedError extends Error {
  override readonly name = 'PoolConfigChangedError'
  /** A pool id, or the factory whose configuration changed. */
  readonly subject: string
  readonly change: PoolConfigChange

  constructor(subject: string, change: PoolConfigChange, detail?: string) {
    super(`${subject}: ${change}${detail === undefined ? '' : ` (${detail})`}`)
    this.subject = subject
    this.change = change
  }
}

export function isPoolConfigChangedError(error: unknown): error is PoolConfigChangedError {
  return error instanceof PoolConfigChangedError
}
