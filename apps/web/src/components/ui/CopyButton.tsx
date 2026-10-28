/**
 * Copy (docs/design/visual-v4.md §4.4, §5.11): a small ghost button whose label swaps to "Copied"
 * with a check for 2 s, announced politely; instant, no toast. `iconOnly` is the icon button
 * beside a mono id or address (About lists, the Mandate list): its icon swaps to the check and
 * `label` is its accessible name; it sits on the text line without growing it.
 */
import { useEffect, useRef, useState } from 'react'
import { DUR } from '../../lib/motion.js'
import { Button, type ButtonVariant, IconButton } from './Button.js'

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } finally {
      ta.remove()
    }
  }
}

export function CopyButton({
  text,
  label,
  variant = 'ghost',
  iconOnly = false,
}: {
  text: string
  /** "Copy HTML", "Copy Markdown", "Copy address"; the accessible name when `iconOnly`. */
  label: string
  variant?: ButtonVariant
  iconOnly?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = () => {
    void writeClipboard(text).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), DUR.copied)
    })
  }
  return (
    <>
      {iconOnly ? (
        <IconButton
          icon={copied ? 'check' : 'copy'}
          label={label}
          className="copy-icon"
          onClick={copy}
        />
      ) : (
        <Button variant={variant} size="sm" icon={copied ? 'check' : 'copy'} onClick={copy}>
          {copied ? 'Copied' : label}
        </Button>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </>
  )
}
