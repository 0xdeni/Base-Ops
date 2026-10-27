/**
 * Buttons (K1, docs/design/visual-v3.md §5.2): primary (at most one per view), secondary, quiet,
 * and the icon button with its required accessible name. 36 px high, 44 on coarse pointers. A
 * loading button keeps its label and adds a 12 px spinner. Press feedback is CSS (motion.css).
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Icon, type IconName } from './Icon.js'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

function classes(variant: ButtonVariant, extra?: string): string {
  return `btn ${variant}${extra ? ` ${extra}` : ''}`
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** A 16 px icon before the label, at an 8 px gap. */
  icon?: IconName
  /** A 16 px icon after the label (the phone Sort button's direction arrow). */
  iconEnd?: IconName
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  icon,
  iconEnd,
  loading = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes(variant, `${loading ? 'is-loading ' : ''}${className ?? ''}`.trim())}
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
  variant = 'secondary',
  icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: ButtonVariant; icon?: IconName; children: ReactNode }) {
  return (
    <Link className={classes(variant, className)} {...rest}>
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

/** 28 × 28 (44 coarse) with a 16 px icon and an 8 px invisible hit-area bleed. */
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
