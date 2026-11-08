import { useEffect, useRef, useState } from 'react'
import { useSync, signIn, signUp, signOut, syncNow, deleteCloudData, deleteAccount } from './lib/sync.ts'
import { exportAll } from './lib/actions.ts'
import { toast } from './lib/store.ts'
import { Icon, Modal, download, ago, navigate } from './ui.tsx'

const LABEL = { local: 'Local only', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Sync failed' } as const

export function Account() {
  const s = useSync()
  const [open, setOpen] = useState(false)
  const [auth, setAuth] = useState<'in' | 'up' | null>(null)
  const [confirm, setConfirm] = useState<'cloud' | 'account' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); window.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', key) }
  }, [open])

  const dot = s.status === 'synced' ? 'ok' : s.status === 'syncing' ? 'busy' : s.status === 'error' || s.status === 'offline' ? 'err' : ''
  const doExport = async () => { download(`automation-report-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(), 'application/json'); setOpen(false) }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="sync-pill" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} title={s.error ?? LABEL[s.status]}>
        <span className={`dot ${dot}`} />
        <span className="hide-sm">{s.email ? LABEL[s.status] : 'Sign in'}</span>
        <Icon name="user" size={15} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {s.email ? (
            <>
              <div style={{ padding: '8px 12px' }}>
                <div className="small">{s.email}</div>
                <div className="xs faint">{LABEL[s.status]}{s.lastSync ? ` · ${ago(s.lastSync)}` : ''}{s.error ? ` · ${s.error}` : ''}</div>
              </div>
              <div className="sep" />
              <button role="menuitem" onClick={() => { void syncNow(); setOpen(false) }}><Icon name="refresh" size={16} />Sync now</button>
              <button role="menuitem" onClick={doExport}><Icon name="download" size={16} />Export all my data (JSON)</button>
              <button role="menuitem" onClick={() => { setConfirm('cloud'); setOpen(false) }}><Icon name="cloud" size={16} />Delete my cloud data</button>
              <button role="menuitem" className="danger" onClick={() => { setConfirm('account'); setOpen(false) }}><Icon name="trash" size={16} />Delete my account</button>
              <div className="sep" />
              <button role="menuitem" onClick={() => { void signOut().then(() => toast({ text: 'Signed out. Your projects stay on this device.' })); setOpen(false) }}>Sign out</button>
            </>
          ) : (
            <>
              <div style={{ padding: '8px 12px' }} className="xs muted">Everything works signed out. An account syncs your reports across devices; ticket text never leaves this browser.</div>
              <button role="menuitem" onClick={() => { setAuth('in'); setOpen(false) }}><Icon name="user" size={16} />Sign in</button>
              <button role="menuitem" onClick={() => { setAuth('up'); setOpen(false) }}><Icon name="plus" size={16} />Create an account</button>
              <div className="sep" />
              <button role="menuitem" onClick={doExport}><Icon name="download" size={16} />Export all my data (JSON)</button>
              <button role="menuitem" onClick={() => { navigate('/app/settings'); setOpen(false) }}><Icon name="settings" size={16} />Settings</button>
            </>
          )}
        </div>
      )}
      {auth && <AuthModal mode={auth} onMode={setAuth} onClose={() => setAuth(null)} />}
      {confirm && <ConfirmDelete what={confirm} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function AuthModal({ mode, onMode, onClose }: { mode: 'in' | 'up'; onMode: (m: 'in' | 'up') => void; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await (mode === 'in' ? signIn(email, pw) : signUp(email, pw))
      toast({ text: mode === 'in' ? 'Signed in. Syncing your reports…' : 'Account created. Syncing your reports…', kind: 'ok' })
      onClose()
    } catch (x) {
      const msg = (x as Error).message
      setErr(/fetch|network/i.test(msg) ? 'Could not reach the sync service. Your work is safe locally; try again later.' : msg)
    } finally { setBusy(false) }
  }
  return (
    <Modal title={mode === 'in' ? 'Sign in' : 'Create an account'} onClose={onClose}>
      <form className="col" onSubmit={submit} style={{ gap: 14 }}>
        <p className="small muted">Syncs project settings and derived reports (intent names, counts, scores, ROI inputs). Ticket text, embeddings and help-centre article bodies stay on this device.</p>
        <label className="field">Email<input className="input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="field">Password<input className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={6} value={pw} onChange={e => setPw(e.target.value)} /></label>
        {err && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? <span className="spinner" /> : null}{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="linkish small" onClick={() => onMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}</button>
      </form>
    </Modal>
  )
}

function ConfirmDelete({ what, onClose }: { what: 'cloud' | 'account'; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      if (what === 'cloud') { await deleteCloudData(); await signOut(); toast({ text: 'Cloud copy deleted and signed out. Local projects are untouched.', kind: 'ok' }) }
      else { await deleteAccount(); toast({ text: 'Account deleted. Local projects are untouched.', kind: 'ok' }) }
      onClose()
    } catch (e) { toast({ text: (e as Error).message, kind: 'error' }); setBusy(false) }
  }
  return (
    <Modal title={what === 'cloud' ? 'Delete your cloud data?' : 'Delete your account?'} onClose={onClose}>
      <p className="muted small">{what === 'cloud' ? 'Removes every synced project and snapshot from the cloud, then signs you out so nothing re-uploads. Projects on this device are kept.' : 'Deletes your cloud data and your account permanently. Projects on this device are kept. This cannot be undone.'}</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 22 }}>
        <button className="btn sm" onClick={onClose}>Cancel</button>
        <button className="btn sm danger" onClick={go} disabled={busy}>{busy && <span className="spinner" />}{what === 'cloud' ? 'Delete cloud data' : 'Delete account'}</button>
      </div>
    </Modal>
  )
}
