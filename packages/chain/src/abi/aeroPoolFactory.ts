/**
 * Aero v2 PoolFactory: one factory per pool type (the volatile and the stable factory in
 * `ChainAddresses.aeroV2`), so `PoolCreated` carries no `stable` flag and `getPool` takes two
 * tokens (either order). Fees in bps: `getBaseFee` asks the factory's `feeModule()`.
 * Signatures per dromos-labs/metadex-public `IPoolFactory.sol` (docs/research/base-contracts.md,
 * `## aero`). The 3-argument `getPool(a, b, bool)` of Aerodrome reverts on these factories.
 */
export const aeroPoolFactoryAbi = [
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'length', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getBaseFee',
    stateMutability: 'view',
    inputs: [
      { name: '_pool', type: 'address' },
      { name: '_caller', type: 'address' },
      { name: '_amount0In', type: 'uint256' },
      { name: '_amount1In', type: 'uint256' },
      { name: '_reserve0', type: 'uint256' },
      { name: '_reserve1', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'feeModule',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
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
    inputs: [{ name: 'index', type: 'uint256' }],
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
    name: 'isPaused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
