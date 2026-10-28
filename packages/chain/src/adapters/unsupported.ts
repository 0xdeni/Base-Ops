/**
 * A DEX id that core defines and this package does not read yet. Its adapter's discovery,
 * overview, state and positions reads, and its seeder, reject with `DexNotSupportedError`, so a
 * pipeline step names the DEX in its failures instead of reporting zero pools. Its swaps take the
 * reader of the DEX whose pools emit the same `Swap` event, so `swapScanOf` groups the scans as it
 * will once the adapter exists (the reader is only called with pools discovery returned).
 */
import type { Dex } from '@depthwatch/core'
import type { DexAdapter } from '../internal/types.js'

export class DexNotSupportedError extends Error {
  readonly dex: Dex

  constructor(dex: Dex, what: string) {
    super(`${dex}: ${what} is not supported yet`)
    this.name = 'DexNotSupportedError'
    this.dex = dex
  }
}

/** An adapter whose every read but `swaps` rejects with `DexNotSupportedError`. */
export function unsupportedAdapter(dex: Dex, swaps: DexAdapter['swaps']): DexAdapter {
  const reject = (what: string) => async (): Promise<never> => {
    throw new DexNotSupportedError(dex, what)
  }
  return {
    dex,
    discover: reject('discovery'),
    overview: reject('overview'),
    state: reject('state'),
    positions: reject('positions'),
    swaps,
  }
}
