/**
 * The Uniswap v4 swap fee: LP fee combined with the protocol fee (v4-core ProtocolFeeLibrary).
 *
 * slot0 packs one uint24 `protocolFee`: the low 12 bits are the fee of zeroForOne swaps, the high
 * 12 bits that of oneForZero swaps, each in pips and at most MAX_PROTOCOL_FEE_PIPS (1 000 = 0.1 %).
 * `Pool.swap` charges the swap fee
 *
 *   swapFee = protocolFee == 0 ? lpFee : protocolFee + lpFee − floor(protocolFee × lpFee / 1e6)
 *
 * (the protocol takes its fee from the input first, the LP fee is taken from the rest) and runs
 * `computeSwapStep` with it; the protocol's share is split off each step's fee afterwards, so the
 * amounts in and out depend only on the combined fee. Uniswap v3 and Slipstream are different:
 * their protocol share is cut from the LP fee and never changes what a trader pays.
 */

import type { ConcentratedState, ProtocolFeePips, SwapDirection } from '../types.js'

/** Largest protocol fee per direction the PoolManager accepts (ProtocolFeeLibrary.MAX_PROTOCOL_FEE). */
export const MAX_PROTOCOL_FEE_PIPS = 1_000

const DIRECTION_BITS = 12
const DIRECTION_MASK = (1 << DIRECTION_BITS) - 1
const PIPS = 1_000_000

/** The two directions of slot0's packed `protocolFee` (uint24). Throws on a value v4 rejects. */
export function decodeV4ProtocolFee(packed: number): ProtocolFeePips {
  if (!Number.isInteger(packed) || packed < 0 || packed >= 1 << (2 * DIRECTION_BITS))
    throw new RangeError(`decodeV4ProtocolFee: not a uint24: ${packed}`)
  const fee: ProtocolFeePips = {
    zeroForOne: packed & DIRECTION_MASK,
    oneForZero: packed >> DIRECTION_BITS,
  }
  if (fee.zeroForOne > MAX_PROTOCOL_FEE_PIPS || fee.oneForZero > MAX_PROTOCOL_FEE_PIPS)
    throw new RangeError(
      `decodeV4ProtocolFee: ${packed} holds a direction above ${MAX_PROTOCOL_FEE_PIPS} pips`,
    )
  return fee
}

/** `ProtocolFeeLibrary.calculateSwapFee`: the fee a v4 swap pays, in pips. */
export function v4SwapFeePips(protocolFeePips: number, lpFeePips: number): number {
  if (!Number.isInteger(protocolFeePips) || protocolFeePips < 0)
    throw new RangeError(`v4SwapFeePips: invalid protocol fee ${protocolFeePips}`)
  if (!Number.isInteger(lpFeePips) || lpFeePips < 0 || lpFeePips > PIPS)
    throw new RangeError(`v4SwapFeePips: invalid LP fee ${lpFeePips}`)
  if (protocolFeePips === 0) return lpFeePips
  // Exact in doubles: protocolFee ≤ 4 095 and lpFee ≤ 1e6 keep the product below 2^53.
  return protocolFeePips + lpFeePips - Math.floor((protocolFeePips * lpFeePips) / PIPS)
}

/** Fee a swap in `direction` pays on a concentrated pool: the LP fee, combined on v4. */
export function swapFeePips(state: ConcentratedState, direction: SwapDirection): number {
  const protocol = state.protocolFeePips?.[direction] ?? 0
  return protocol === 0 ? state.feePips : v4SwapFeePips(protocol, state.feePips)
}
