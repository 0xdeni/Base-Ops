/**
 * Uniswap v4 PositionManager (Base: 0x7c5f5a4bbd8fd63184577525326123b519429bdc).
 * `positionInfo` is a packed uint256: `200 bits poolId | 24 bits tickUpper | 24 bits tickLower |
 * 8 bits hasSubscriber` (MSB first). Liquidity changes are attributed through PoolManager's
 * `ModifyLiquidity` with `sender == PositionManager` and `salt == bytes32(tokenId)`; the Base
 * deployment predates the periphery `ModifyPosition` event and does not emit it.
 */
export const v4PositionManagerAbi = [
  {
    type: 'function',
    name: 'positionInfo',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'info', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPoolAndPositionInfo',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'info', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getPositionLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'poolKeys',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes25' }],
    outputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'nextTokenId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Subscription',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'subscriber', type: 'address', indexed: true },
    ],
  },
] as const
