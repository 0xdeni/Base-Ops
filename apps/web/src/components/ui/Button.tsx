/**
 * Buttons (docs/design/visual-v4.md §5.3): 48 px high (40 small), radius 12, 15 px / 750 labels.
 * - `primary`: Blue fill, white label; at most one filled button per view (P11);
 * - `band`: the white button on the band, Blue label, navy shadow;
 * - `ghost`: a 1.5 px `--line-2` outline (on the band it turns white, as `band-ghost`);
 * - `band-ghost`: a 1.5 px white 55 % outline on the band.
 * The icon button is 36 × 36 (44 on touch) with its required accessible name. A loading button
 * keeps its label and adds a 12 px ring. Press scales 0.97 (motion.css).
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Icon, type IconName } from './Icon.js'

/**
 * The variants of §5.3. `secondary` and `quiet` are the v3 names some pages still pass: the ghost
 * and the small ghost.
 */
export type ButtonVariant = 'primary' | 'band' | 'ghost' | 'band-ghost' | 'secondary' | 'quiet'
export type ButtonSize = 'md' | 'sm'

/** The class list of a button: `btn`, the variant and the size. */
export function buttonClass(variant: ButtonVariant, size: ButtonSize = 'md', extra?: string) {
  const v = variant === 'secondary' || variant === 'quiet' ? 'ghost' : variant
  const sm = size === 'sm' || variant === 'quiet'
  return `btn ${v}${sm ? ' is-sm' : ''}${extra ? ` ${extra}` : ''}`
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** A 16 px icon before the label, at an 8 px gap. */
  icon?: IconName
  /** A 16 px icon after the label (the phone Sort button's direction arrow). */
  iconEnd?: IconName
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  iconEnd,
  loading = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const extra = `${loading ? 'is-loading ' : ''}${className ?? ''}`.trim()
  return (
    <button
      type={type}
      className={buttonClass(variant, size, extra || undefined)}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} /> : null}
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
    </button>
  )
}

/** An in-app link styled as a button ("Browse pools"). */
export function ButtonLink({
  variant = 'ghost',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: LinkProps & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  children: ReactNode
}) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  )
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: IconName
  /** Required: the button's accessible name ("Show price in WETH"). */
  label: string
  ref?: Ref<HTMLButtonElement>
}

/** 36 × 36 (44 on a coarse pointer), radius 10, a 16 px icon in a 1.5 px outline. */
export function IconButton({ icon, label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}
