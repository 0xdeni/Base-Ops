import type { Dex } from '@depthwatch/core'
import type { DexAdapter } from '../internal/types.js'
import { aerodromeSlipstreamAdapter } from './aerodromeSlipstream.js'
import { aerodromeV2Adapter } from './aerodromeV2.js'
import { uniswapV3Adapter } from './uniswapV3.js'
import { uniswapV4Adapter } from './uniswapV4.js'

export const ADAPTERS: Readonly<Record<Dex, DexAdapter>> = Object.freeze({
  'uniswap-v3': uniswapV3Adapter,
  'uniswap-v4': uniswapV4Adapter,
  'aerodrome-v2': aerodromeV2Adapter,
  'aerodrome-slipstream': aerodromeSlipstreamAdapter,
})

export { aerodromeSlipstreamAdapter, aerodromeV2Adapter, uniswapV3Adapter, uniswapV4Adapter }
