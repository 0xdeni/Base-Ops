/**
 * Aero Slipstream NonfungiblePositionManager ("Slipstream V3 Deposit"). `positions()` is the
 * `slipstreamNFPMAbi` one (12 outputs, `int24 tickSpacing` fifth), but `IncreaseLiquidity` also
 * carries the position's ticks: 6 fields, topic0 0x0f8712c4…, where the Uniswap v3 and Aerodrome
 * NFPMs emit the 4-field 0x3067048b…. A scan with `slipstreamNFPMAbi` would miss increase-only
 * changes. `DecreaseLiquidity`, `Collect` and `Transfer` are unchanged. Per
 * dromos-labs/metadex-slipstream-public `INonfungiblePositionManager.sol`.
 */
export const aeroNFPMAbi = [
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
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
    type: 'event',
    name: 'IncreaseLiquidity',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'tickLower', type: 'int24', indexed: false },
      { name: 'tickUpper', type: 'int24', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DecreaseLiquidity',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Collect',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const
