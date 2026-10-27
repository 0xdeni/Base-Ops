/**
 * The back link above every detail title (K2, §5.2): a 16 px left chevron plus the list's name,
 * 13 / 500 text-2. Its chevron's optical edge aligns with the title (−4 px margin).
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
