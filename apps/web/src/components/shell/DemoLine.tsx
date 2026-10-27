/**
 * The demo line (ia-v3 §3.1, docs/design/visual-v3.md §5.1): one 28 px line in `well` that never
 * wraps, shown only for the synthetic demo world or the in-repo mock. Its quiet link opens a
 * popover with the full sentence. The only place in the chrome that says "demo" (D7).
 */
import { Popover } from '../ui/Popover.js'

export function DemoLine({ mode }: { mode: 'demo' | 'mock' }) {
  return (
    <div className="demo-line" role="note" aria-label="Data source">
      <div className="wrap demo-inner">
        <span>{mode === 'demo' ? 'Demo data: a synthetic week of Base' : 'In-repo mock data'}</span>
        <Popover
          label={mode === 'demo' ? 'About the demo' : 'About the mock data'}
          triggerLabel={mode === 'demo' ? 'About the demo' : 'About the data'}
          trigger={
            <>
              About<span className="demo-more"> the {mode === 'demo' ? 'demo' : 'data'}</span>
            </>
          }
          triggerClassName="quiet-link touch-hit"
        >
          <p>
            {mode === 'demo'
              ? 'Every number comes from the real pipeline run over a simulated week of Base.'
              : 'This dashboard runs with VITE_MOCK=1, or the development server found no API, so it shows the pools bundled with the repository, not Base data.'}
          </p>
        </Popover>
      </div>
    </div>
  )
}
