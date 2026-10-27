/**
 * Uniswap v3 TickLens (Base: 0x0cdee061c75d43c82520ed998c23ac2991c9ac6d). Kept for future use: the
 * reader walks `tickBitmap` + `ticks` itself so that one code path serves v3, Slipstream and v4.
 * Note TickLens cannot be pointed at Slipstream pools (their `ticks()` struct differs).
 */
export const tickLensAbi = [
  {
    type: 'function',
    name: 'getPopulatedTicksInWord',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'tickBitmapIndex', type: 'int16' },
    ],
    outputs: [
      {
        name: 'populatedTicks',
        type: 'tuple[]',
        components: [
          { name: 'tick', type: 'int24' },
          { name: 'liquidityNet', type: 'int128' },
          { name: 'liquidityGross', type: 'uint128' },
        ],
      },
    ],
  },
] as const
