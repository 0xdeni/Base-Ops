/**
 * "Skip to content" (A4): the first focusable element, 44 px high, visible only on focus. It moves
 * focus to <main> directly, so it also works under the static build's hash router.
 */
export function SkipLink() {
  return (
    // biome-ignore lint/a11y/useValidAnchor: a real link to #main whose click also moves focus, since the static build's hash router owns the URL hash
    <a
      className="skip"
      href="#main"
      onClick={(e) => {
        const main = document.getElementById('main')
        if (!main) return
        e.preventDefault()
        main.focus({ preventScroll: true })
        main.scrollIntoView({ block: 'start' })
      }}
    >
      Skip to content
    </a>
  )
}
