/** Aerodrome v2 PoolFactory (Base: 0x420dd381b31aef6683db6b902084cb0ffece40da). Fees in bps. */
export const aerodromePoolFactoryAbi = [
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'stable', type: 'bool', indexed: true },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'length', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SetCustomFee',
    inputs: [
      { name: 'pool', type: 'address', indexed: true },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getFee',
    stateMutability: 'view',
    inputs: [
      { name: '_pool', type: 'address' },
      { name: '_stable', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'stable', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'address' }],
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
  {
    type: 'function',
    name: 'allPools',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'stableFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'volatileFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
