/**
 * The Token title section (docs/design/visual-v4.md §6.8): the back link to Pools, the eyebrow
 * "TOKEN", then a two-column grid from 1024 px: the token's label (its symbol, or "AERO (Aero)"
 * beside another AERO) as the h1 with the token's name under it at left, and the answer sentence
 * at right, bottom-aligned. The title and the answer rise with the first view; the back link, the
 * eyebrow and the name fade in (`data-in`).
 */
import type { ReactNode } from 'react'
import type { TokenDetail } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { tokenText } from '../../lib/format.js'

export function TokenTitle({
  token,
  answer,
}: {
  token: TokenDetail['token']
  /** The answer sentence, or its skeleton while the token loads. */
  answer: ReactNode
}) {
  return (
    <section className="wrap ttl token-ttl" aria-labelledby="token-title">
      <div data-in="">
        <BackLink to="/pools" label="Pools" />
      </div>
      <p className="eyebrow eb-row token-eb" data-in="">
        <span>Token</span>
      </p>
      <div className="ttl-grid">
        <div className="token-ttl-main">
          <h1 className="title token-title" id="token-title" data-rise="">
            {tokenText(token)}
          </h1>
          <p className="token-name" data-in="">
            {token.name}
          </p>
        </div>
        {answer}
      </div>
    </section>
  )
}
