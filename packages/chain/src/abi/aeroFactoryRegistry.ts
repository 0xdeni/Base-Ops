/**
 * Aero FactoryRegistry (`ChainAddresses.aeroV2.factoryRegistry`): every pool of an approved factory
 * is a target, and `targetToGauge(pool)` is its gauge (address(0) without one); it also answers for
 * Aero Slipstream pools. The LeafVoter has none of the old Voter's pool views, so gauges are read
 * here. Signatures per dromos-labs/metadex-public `IFactoryRegistry.sol`.
 */
export const aeroFactoryRegistryAbi = [
  {
    type: 'function',
    name: 'targetToGauge',
    stateMutability: 'view',
    inputs: [{ name: '_target', type: 'address' }],
    outputs: [{ name: '_gauge', type: 'address' }],
  },
  {
    type: 'function',
    name: 'targetToFactory',
    stateMutability: 'view',
    inputs: [{ name: '_target', type: 'address' }],
    outputs: [{ name: '_factory', type: 'address' }],
  },
] as const
