/**
 * Aerodrome v2 Pool (volatile x·y and stable x³y+xy³). Reserves are uint256, Swap has in/out amounts.
 * Aero v2 pools share `getReserves` and `Swap`, but their `metadata()` has 6 outputs (no `stable`)
 * and `stable()` reverts (they expose `POOL_TYPE()`), so neither is read through this ABI for them.
 */
export const aerodromePoolAbi = [
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_reserve0', type: 'uint256' },
      { name: '_reserve1', type: 'uint256' },
      { name: '_blockTimestampLast', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'stable',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'factory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'metadata',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'dec0', type: 'uint256' },
      { name: 'dec1', type: 'uint256' },
      { name: 'r0', type: 'uint256' },
      { name: 'r1', type: 'uint256' },
      { name: 'st', type: 'bool' },
      { name: 't0', type: 'address' },
      { name: 't1', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'getAmountOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenIn', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount0In', type: 'uint256', indexed: false },
      { name: 'amount1In', type: 'uint256', indexed: false },
      { name: 'amount0Out', type: 'uint256', indexed: false },
      { name: 'amount1Out', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Sync',
    inputs: [
      { name: 'reserve0', type: 'uint256', indexed: false },
      { name: 'reserve1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Mint',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Burn',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
] as const
