/**
 * The Pool title block (ia-v3 §4.3, docs/design/visual-v3.md §6.3): the back link to Pools, the
 * pair as the h1 with each symbol linking to its token page, then one secondary line: DEX and fee,
 * and "1 WETH = 2,460.32 USDC" with a ⇄ icon button that flips it (N2). The line starts from the
 * pool's base token (`lib/orient.ts`), so a price below 1 ("1 USDC = 0.7951 AERO") only shows
 * behind the toggle. Only the characters that change settle in (§4 row 12); a keyboard flip swaps
 * instantly.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PoolMetaDto } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { IconButton } from '../../components/ui/Button.js'
import { TextChange } from '../../components/ui/TextChange.js'
import { dexLabel, fee, NB, price, tokenHref } from '../../lib/format.js'
import { isKeyboardClick } from '../../lib/motion.js'
import { baseQuote } from '../../lib/orient.js'

function priceLine(base: string, quote: string, v: number): string {
  return `1${NB}${base} = ${price(v)}${NB}${quote}`
}

export function PoolTitle({ pool, spot }: { pool: PoolMetaDto; spot: number | null }) {
  const [inverse, setInverse] = useState(false)
  const [animate, setAnimate] = useState(true)
  const t0 = pool.token0.symbol
  const t1 = pool.token1.symbol
  // The default line reads from the base token; ⇄ shows the other direction.
  const { inverted } = baseQuote(pool, spot)
  const flip = inverse !== inverted
  const line =
    spot === null || spot <= 0 ? null : flip ? priceLine(t1, t0, 1 / spot) : priceLine(t0, t1, spot)
  return (
    <div className="title-block">
      <BackLink to="/pools" label="Pools" />
      <h1 className="h1">
        <Link className="tlink touch-hit" to={tokenHref(pool.token0.address)}>
          {t0}
        </Link>{' '}
        /{' '}
        <Link className="tlink touch-hit" to={tokenHref(pool.token1.address)}>
          {t1}
        </Link>
      </h1>
      <div className="subline">
        <span>
          {dexLabel(pool.dex)}, {fee(pool.feePips)} fee
        </span>
        {line ? (
          <span className="pool-price">
            <TextChange className="num" value={line} animate={animate} />
            <IconButton
              icon="swap"
              label={`Show price in ${flip ? t1 : t0}`}
              onClick={(e) => {
                setAnimate(!isKeyboardClick(e))
                setInverse((v) => !v)
              }}
            />
          </span>
        ) : null}
      </div>
    </div>
  )
}
