/**
 * Aerodrome Slipstream CLGauge: a staked position NFT is transferred to the gauge (the NFPM reports
 * the gauge as `ownerOf`) and the gauge remembers the depositor: `stakedContains(depositor, tokenId)`
 * / `stakedValues(depositor)`. The pool's gauge is `CLPool.gauge()` (or `Voter.gauges(pool)`).
 * Signatures per docs/research/base-contracts.md §2.4 and the event table (ICLGauge.sol).
 */
export const aerodromeCLGaugeAbi = [
  {
    type: 'function',
    name: 'stakedContains',
    stateMutability: 'view',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'stakedValues',
    stateMutability: 'view',
    inputs: [{ name: 'depositor', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'stakedLength',
    stateMutability: 'view',
    inputs: [{ name: 'depositor', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pool',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'nft',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'liquidityToStake', type: 'uint128', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'liquidityToStake', type: 'uint128', indexed: true },
    ],
  },
] as const
