import { useEffect, useState, lazy, Suspense } from 'react'
import { Landing, Footer } from './Landing.tsx'
import { Link, Icon, Toasts, Modal, usePath, navigate } from './ui.tsx'
import { loadProjects } from './lib/store.ts'
import { initSync } from './lib/sync.ts'
import { Account } from './Account.tsx'

const Workspace = lazy(() => import('./Workspace.tsx'))
const ImportPage = lazy(() => import('./Import.tsx'))
const ProjectView = lazy(() => import('./ProjectView.tsx'))
const ReportPage = lazy(() => import('./Report.tsx'))
const Docs = lazy(() => import('./Docs.tsx'))
const SettingsPage = lazy(() => import('./Settings.tsx'))

function useTheme(): [string, () => void] {
  const [mode, setMode] = useState(document.documentElement.dataset.themeMode ?? 'dark')
  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.themeMode = next
    localStorage.setItem('themeMode', next)
    setMode(next)
  }
  return [mode, toggle]
}

export function App() {
  const path = usePath()
  const [mode, toggle] = useTheme()
  const [help, setHelp] = useState(false)

  useEffect(() => { void loadProjects(); void initSync() }, [])

  useEffect(() => {
    let g = false
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return
      if (g) {
        g = false
        if (e.key === 'h') navigate('/')
        if (e.key === 'p') navigate('/app')
        if (e.key === 'd') navigate('/docs')
        if (e.key === 's') navigate('/app/settings')
        return
      }
      if (e.key === 'g') { g = true; setTimeout(() => (g = false), 900) }
      else if (e.key === '?') setHelp(h => !h)
      else if (e.key === 't') toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const m = path.match(/^\/app\/p\/([^/]+)(?:\/([a-z]+))?\/?$/)
  let page: React.ReactNode
  if (path === '/') page = <Landing />
  else if (path === '/app' || path === '/app/') page = <Workspace />
  else if (path === '/app/import') page = <ImportPage />
  else if (path === '/app/settings') page = <SettingsPage />
  else if (path === '/docs') page = <Docs />
  else if (path === '/r') page = <ReportPage shared />
  else if (m && m[2] === 'report') page = <ReportPage projectId={m[1]} />
  else if (m && m[2] === 'import') page = <ImportPage projectId={m[1]} />
  else if (m) page = <ProjectView id={m[1]} tab={m[2] ?? 'overview'} />
  else page = <NotFound />

  return (
    <>
      <a href="#main" className="sr">Skip to content</a>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="brand"><span className="mono-badge">AR</span><span className="hide-sm">Automation Report</span></Link>
          <nav className="nav-links" aria-label="Main">
            <Link to="/app">Projects</Link>
            <Link to="/docs">Docs</Link>
            <Link to="/app/settings">Settings</Link>
          </nav>
          <div className="nav-right">
            <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`} title="Toggle theme (t)"><Icon name={mode === 'dark' ? 'sun' : 'moon'} size={16} /></button>
            <Account />
            {path === '/' && <Link to="/app" className="btn primary sm">Open app</Link>}
          </div>
        </div>
      </header>
      <div id="main">
        <Suspense fallback={<div className="wrap app-main"><div className="skeleton" style={{ height: 48, width: 320 }} /><div className="skeleton" style={{ height: 320, marginTop: 24 }} /></div>}>
          {page}
        </Suspense>
      </div>
      {path !== '/' && path !== '/r' && <Footer />}
      <Toasts />
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <table className="table"><tbody>
            {[['?', 'Show this help'], ['t', 'Toggle light / dark'], ['g then p', 'Projects'], ['g then d', 'Docs'], ['g then s', 'Settings'], ['g then h', 'Home'], ['1 – 7', 'Switch project tabs'], ['/', 'Search intents'], ['i', 'New import into this project'], ['p', 'Open the printable report'], ['m', 'Merge selected intents'], ['Esc', 'Close dialogs and drawers']].map(([k, v]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td className="muted">{v}</td></tr>
            ))}
          </tbody></table>
        </Modal>
      )}
    </>
  )
}

function NotFound() {
  return (
    <main className="wrap app-main gridbg" style={{ textAlign: 'center', paddingTop: 120 }}>
      <span className="eyebrow">404</span>
      <h1 className="display" style={{ fontSize: 'clamp(40px,6vw,72px)', marginTop: 16 }}>This page was <em>not</em> resolved</h1>
      <p className="lead" style={{ marginTop: 16 }}>No intent matched <span className="mono">{location.pathname}</span>.</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 28 }}>
        <Link to="/" className="btn">Home</Link>
        <Link to="/app" className="btn primary">Open projects</Link>
      </div>
    </main>
  )
}
