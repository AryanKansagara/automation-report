import { useEffect, useRef, useState } from 'react'
import { useProjects, saveProject, toast } from './lib/store.ts'
import { openSample, deleteProject } from './lib/actions.ts'
import type { Progress } from './lib/pipeline.ts'
import type { Project } from './lib/db.ts'
import { effectiveTier } from './engine/analyze.ts'
import { Icon, Link, navigate, ago, fmtInt, fmtPct, Modal } from './ui.tsx'

export function ProgressPanel({ title, progress }: { title: string; progress: Progress | null }) {
  return (
    <div className="card" style={{ maxWidth: 620, margin: '40px auto', padding: 32 }} aria-live="polite">
      <div className="row"><span className="spinner" /><h3>{title}</h3></div>
      <p className="small muted" style={{ marginTop: 16 }}>{progress?.stage ?? 'Starting…'}{progress?.detail ? ` · ${progress.detail}` : ''}</p>
      <div className="bar" style={{ marginTop: 10 }}><i style={{ width: `${Math.round((progress?.p ?? 0) * 100)}%` }} /></div>
      <p className="xs faint" style={{ marginTop: 16 }}>Everything runs in this tab. Nothing is uploaded.</p>
    </div>
  )
}

export default function Workspace() {
  const { projects, loaded } = useProjects()
  const [sample, setSample] = useState<Progress | null>(null)
  const started = useRef(false)

  const runSample = async () => {
    setSample({ stage: 'Generating 2,550 synthetic tickets', p: 0 })
    try {
      const p = await openSample(setSample)
      navigate(`/app/p/${p.id}`, true)
    } catch (e) {
      setSample(null)
      toast({ text: `Sample failed: ${(e as Error).message}`, kind: 'error' })
    }
  }

  useEffect(() => {
    if (!loaded || started.current) return
    if (new URLSearchParams(location.search).get('sample')) { started.current = true; void runSample() }
  }, [loaded])

  if (sample) return <main className="wrap app-main"><ProgressPanel title="Building the sample report" progress={sample} /></main>
  if (!loaded) return <main className="wrap app-main"><div className="skeleton" style={{ height: 300 }} /></main>

  return (
    <main className="wrap app-main">
      {projects.length === 0 ? (
        <div className="empty gridbg">
          <span className="eyebrow">Welcome</span>
          <h2 style={{ marginTop: 14 }}>Your first automation report is <em>minutes</em> away</h2>
          <p className="lead" style={{ maxWidth: 600, margin: '16px auto 0' }}>Bring a ticket export from Zendesk, Intercom, Freshdesk or any CSV. Or explore a realistic synthetic store first.</p>
          <div className="ctas">
            <button className="btn primary lg" onClick={runSample}>Try the sample <Icon name="arrow" size={16} /></button>
            <Link to="/app/import" className="btn lg"><Icon name="upload" size={16} />Import your data</Link>
          </div>
          <p className="small muted" style={{ marginTop: 24 }}>Not sure how to export? <Link to="/docs">Step-by-step guides for each helpdesk</Link>.</p>
        </div>
      ) : (
        <>
          <div className="page-head">
            <div><span className="eyebrow">Workspace</span><h1 style={{ marginTop: 8 }}>Projects</h1></div>
            <div className="row">
              {!projects.some(p => p.isSample) && <button className="btn sm" onClick={runSample}>Try the sample</button>}
              <Link to="/app/import" className="btn primary sm"><Icon name="plus" size={15} />New project</Link>
            </div>
          </div>
          <div className="proj-grid">{projects.map(p => <ProjectCard key={p.id} p={p} />)}</div>
        </>
      )}
    </main>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const [rename, setRename] = useState(false)
  const s = p.snapshots.find(x => x.id === p.activeSnapshot) ?? p.snapshots[p.snapshots.length - 1]
  const vol = (t: string) => (s ? s.intents.filter(i => effectiveTier(i) === t).reduce((a, i) => a + i.share, 0) : 0)
  return (
    <div className="card proj-card" onClick={e => { if (!(e.target as HTMLElement).closest('button')) navigate(`/app/p/${p.id}`) }} role="link" tabIndex={0} onKeyDown={e => e.key === 'Enter' && navigate(`/app/p/${p.id}`)}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h3 style={{ fontSize: 20 }}>{p.name}</h3>
          <p className="xs faint" style={{ marginTop: 4 }}>{p.snapshots.length} snapshot{p.snapshots.length === 1 ? '' : 's'} · updated {ago(p.updatedAt)}{p.syncedAt ? ' · synced' : ''}</p>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label={`Rename ${p.name}`} onClick={() => setRename(true)}><Icon name="edit" size={15} /></button>
          <button className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => deleteProject(p.id)}><Icon name="trash" size={15} /></button>
        </div>
      </div>
      {s ? (
        <>
          <div className="row" style={{ gap: 24 }}>
            <div><div className="xs faint">Tickets</div><div style={{ fontSize: 22 }} className="num">{fmtInt(s.total)}</div></div>
            <div><div className="xs faint">Intents</div><div style={{ fontSize: 22 }} className="num">{s.intents.length}</div></div>
            <div><div className="xs faint">Automatable</div><div style={{ fontSize: 22, color: 'var(--tier-auto)' }} className="num">{fmtPct(vol('automatable'))}</div></div>
          </div>
          <div className="meter" aria-hidden="true">
            <i style={{ width: fmtPct(vol('automatable')), background: 'var(--tier-auto)' }} />
            <i style={{ width: fmtPct(vol('action')), background: 'var(--tier-action)' }} />
            <i style={{ width: fmtPct(vol('human')), background: 'var(--tier-human)' }} />
          </div>
          <p className="xs faint">Latest: {s.label}</p>
        </>
      ) : <p className="small muted">No imports yet. <Link to={`/app/p/${p.id}/import`}>Import tickets</Link></p>}
      {rename && <RenameModal title="Rename project" value={p.name} onClose={() => setRename(false)} onSave={v => saveProject({ ...p, name: v })} />}
    </div>
  )
}

export function RenameModal({ title, value, onSave, onClose, multiline }: { title: string; value: string; onSave: (v: string) => void; onClose: () => void; multiline?: boolean }) {
  const [v, setV] = useState(value)
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (v.trim()) { onSave(v.trim()); onClose() } }} className="col" onClick={e => e.stopPropagation()}>
        {multiline ? <textarea className="input" rows={4} value={v} onChange={e => setV(e.target.value)} /> : <input className="input" value={v} onChange={e => setV(e.target.value)} maxLength={120} />}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn sm" onClick={onClose}>Cancel</button><button className="btn primary sm">Save</button></div>
      </form>
    </Modal>
  )
}
