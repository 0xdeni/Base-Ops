/**
 * The back link above every detail title (docs/design/visual-v4.md §5.3): a 16 px chevron and the
 * list's name, 14 px / 700, `--text-2` (`--text-1` on hover), 32 px high (44 on touch), 4 px left
 * of the edge so the chevron's optical edge aligns with the title.
 */
import { Link } from 'react-router-dom'
import { Icon } from './Icon.js'

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="back" to={to}>
      <Icon name="chevLeft" />
      <span>{label}</span>
    </Link>
  )
}
