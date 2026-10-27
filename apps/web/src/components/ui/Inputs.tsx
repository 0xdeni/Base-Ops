/**
 * Inputs (K6, docs/design/visual-v3.md §5.4): the search field with its 16 px icon and a visually
 * hidden label, and the checkbox ("Whole-pool depth"). There is no native select: segmented
 * controls on desktop, sheets on phones.
 */
import { type InputHTMLAttributes, type ReactNode, useId, useRef } from 'react'
import { Icon } from './Icon.js'

export function SearchInput({
  label = 'Search pools',
  placeholder = 'Search by symbol or address',
  value,
  onChange,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  /** Visually hidden; the placeholder is never the only label. */
  label?: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className={`search${className ? ` ${className}` : ''}`}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Icon name="search" />
      <input
        id={id}
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  /** `keyboard` is true when Space toggled it: callers skip their morph (M2). */
  onChange: (checked: boolean, meta: { keyboard: boolean }) => void
  children: ReactNode
}) {
  const pointer = useRef(false)
  return (
    <label
      className="check"
      onPointerDown={() => {
        pointer.current = true
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          const keyboard = !pointer.current
          pointer.current = false
          onChange(e.target.checked, { keyboard })
        }}
      />
      <span>{children}</span>
    </label>
  )
}
