/** Aerodrome Slipstream CLFactory. Pools are keyed by tickSpacing; `PoolCreated` differs from v3. */
export const aerodromeCLFactoryAbi = [
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: true },
      { name: 'pool', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TickSpacingEnabled',
    inputs: [
      { name: 'tickSpacing', type: 'int24', indexed: true },
      { name: 'fee', type: 'uint24', indexed: true },
    ],
  },
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'tickSpacing', type: 'int24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tickSpacingToFee',
    stateMutability: 'view',
    inputs: [{ name: 'tickSpacing', type: 'int24' }],
    outputs: [{ name: 'fee', type: 'uint24' }],
  },
  {
    type: 'function',
    name: 'getSwapFee',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'uint24' }],
  },
  {
    type: 'function',
    name: 'tickSpacings',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'int24[]' }],
  },
  {
    type: 'function',
    name: 'isPool',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allPoolsLength',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
