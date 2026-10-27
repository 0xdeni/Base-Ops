/**
 * Aerodrome Voter (shared by v2 pools and Slipstream): `gauges(pool)` is the canonical pool → gauge
 * mapping (address(0) when the pool has no gauge). Signatures per docs/research/base-contracts.md
 * §A.5 (IVoter.sol); the deployed address is `ChainAddresses.aerodromeV2.voter`.
 */
export const aerodromeVoterAbi = [
  {
    type: 'function',
    name: 'gauges',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'poolForGauge',
    stateMutability: 'view',
    inputs: [{ name: 'gauge', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isGauge',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isAlive',
    stateMutability: 'view',
    inputs: [{ name: 'gauge', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'GaugeCreated',
    inputs: [
      { name: 'poolFactory', type: 'address', indexed: true },
      { name: 'votingRewardsFactory', type: 'address', indexed: true },
      { name: 'gaugeFactory', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'bribeVotingReward', type: 'address', indexed: false },
      { name: 'feeVotingReward', type: 'address', indexed: false },
      { name: 'gauge', type: 'address', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
    ],
  },
] as const
