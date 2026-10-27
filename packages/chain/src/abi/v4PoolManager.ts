/**
 * Uniswap v4 PoolManager events and `extsload` (Base: 0x498581ff718922c3f8e6a244956af099b2652b2b).
 * `Swap.amount0/amount1` are the swapper's balance delta: NEGATIVE = paid into the pool. The
 * adapter negates them to the DESIGN convention (positive = flowed into the pool).
 */
export const v4PoolManagerAbi = [
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'currency0', type: 'address', indexed: true },
      { name: 'currency1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'hooks', type: 'address', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'int128', indexed: false },
      { name: 'amount1', type: 'int128', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
      { name: 'fee', type: 'uint24', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ModifyLiquidity',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'tickLower', type: 'int24', indexed: false },
      { name: 'tickUpper', type: 'int24', indexed: false },
      { name: 'liquidityDelta', type: 'int256', indexed: false },
      { name: 'salt', type: 'bytes32', indexed: false },
    ],
  },
  /**
   * IExtsload: one raw storage word. StateView reads pool state through it; seeding reads a pool's
   * slot0 word (`keccak256(poolId ‖ POOLS_SLOT = 6)`) at historical blocks, see seed/createdAt.ts.
   */
  {
    type: 'function',
    name: 'extsload',
    stateMutability: 'view',
    inputs: [{ name: 'slot', type: 'bytes32' }],
    outputs: [{ name: 'value', type: 'bytes32' }],
  },
] as const
