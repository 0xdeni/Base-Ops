/**
 * Aero Slipstream DynamicSwapFeeHook (`AeroSlipstreamDeployment.swapHook`): a pool's fee is
 * `min(baseFee + dynamic part, feeCap)`, fixed for a block by its first swap; with
 * `initialFeeEnabled` the first transaction of a block pays `initialFee` instead. Signature per
 * dromos-labs/metadex-public `IDynamicSwapFeeHook.sol`; fees in pips.
 */
export const aeroSwapHookAbi = [
  {
    type: 'function',
    name: 'dynamicFeeConfig',
    stateMutability: 'view',
    inputs: [{ name: '_pool', type: 'address' }],
    outputs: [
      { name: '_baseFee', type: 'uint24' },
      { name: '_feeCap', type: 'uint24' },
      { name: '_scalingFactor', type: 'uint64' },
      { name: '_initialFeeEnabled', type: 'bool' },
      { name: '_initialFee', type: 'uint24' },
    ],
  },
] as const
