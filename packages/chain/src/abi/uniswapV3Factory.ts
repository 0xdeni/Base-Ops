/** UniswapV3Factory (Base: 0x33128a8fc17869897dce68ed026d694621f6fdfd). */
export const uniswapV3FactoryAbi = [
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FeeAmountEnabled',
    inputs: [
      { name: 'fee', type: 'uint24', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: true },
    ],
  },
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
  {
    type: 'function',
    name: 'feeAmountTickSpacing',
    stateMutability: 'view',
    inputs: [{ name: 'fee', type: 'uint24' }],
    outputs: [{ name: '', type: 'int24' }],
  },
] as const
