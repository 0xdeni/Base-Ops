// The shared stylesheet loads first, so a page sheet (imported by its page through App) can
// override a shared rule at equal specificity.
import './styles/index.css'
import { createRoot } from 'react-dom/client'
import { startLive } from './liveBoot.js'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('missing #root element')
const root = createRoot(rootEl)

if (import.meta.env.VITE_STATIC === '1') {
  // Static build: the exported bundle next to the site, no server (docs/design/web-v2.md §4).
  void import('./staticBoot.js').then(({ startStatic }) => startStatic(root))
} else {
  void startLive(root)
}
