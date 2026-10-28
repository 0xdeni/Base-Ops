/**
 * Embed badge parts (docs/design/visual-v4.md §5.11): the API's badge SVG unaltered, "Copy HTML" and
 * "Copy Markdown" (ghost, small) with "Cached for 5 minutes", and the code blocks that "Show code"
 * in the section's head reveals. Presentational: the page supplies the SVG, snippets and URL.
 */
import { svgDataUri } from '../../lib/badge.js'
import { CopyButton } from './CopyButton.js'

export function BadgePreview({ svg, alt }: { svg: string; alt: string }) {
  return (
    <div className="badge-prev">
      <img src={svgDataUri(svg)} alt={alt} data-testid="badge-preview" />
    </div>
  )
}

/** The two copy buttons, kept together as one unit whatever the badge's width. */
function CopyPair({ html, markdown }: { html: string; markdown: string }) {
  return (
    <div className="copy-row">
      <CopyButton text={html} label="Copy HTML" />
      <CopyButton text={markdown} label="Copy Markdown" />
    </div>
  )
}

export function EmbedActions({ html, markdown }: { html: string; markdown: string }) {
  return (
    <>
      <CopyPair html={html} markdown={markdown} />
      <p className="cap">Cached for 5 minutes.</p>
    </>
  )
}

/** Captioned mono code blocks that scroll sideways instead of breaking a path. */
export function CodeBlocks({ blocks }: { blocks: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div>
      {blocks.map(([label, text]) => (
        <div key={label}>
          <p className="code-label">{label}</p>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling code block must be reachable by keyboard */}
          <pre className="codeblock" tabIndex={0}>
            <code>{text}</code>
          </pre>
        </div>
      ))}
    </div>
  )
}

export function EmbedCode({
  html,
  markdown,
  url,
}: {
  html: string
  markdown: string
  url: string
}) {
  return (
    <CodeBlocks
      blocks={[
        ['HTML', html],
        ['Markdown', markdown],
        ['Badge URL', url],
      ]}
    />
  )
}
