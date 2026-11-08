import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, SnapshotLocal } from './lib/db.ts'
import { effectiveTier, type Intent, type Snapshot } from './engine/analyze.ts'
import { ACTIONS, TIER_LABEL, fmtMinutes, type Tier } from './engine/score.ts'
import { intentValue, monthlyVolume } from './engine/roi.ts'
import { answerOutline } from './engine/outputs.ts'
import { ticketText } from './engine/lexical.ts'
import { merge, split, patchIntent, setOverride } from './lib/actions.ts'
import { toast } from './lib/store.ts'
import { Icon, TierBadge, ScoreRing, fmtInt, fmtMoney, fmtPct, Modal, tierColor, copy } from './ui.tsx'
import { RenameModal } from './Workspace.tsx'

type Sort = 'size' | 'score' | 'value'

export default function Intents({ p, s, local }: { p: Project; s: Snapshot; local: SnapshotLocal | null | 'missing' }) {
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<Tier | 'all'>('all')
  const [sort, setSort] = useState<Sort>('size')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get('i'))
  const [mergeOpen, setMergeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape') { setOpen(null); return }
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || e.metaKey || e.ctrlKey) return
      if (e.key === '/') { e.preventDefault(); search.current?.focus() }
      if (e.key === 'm' && picked.size >= 2) setMergeOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked])

  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    const list = s.intents.map(i => ({ i, v: intentValue(i, s, p.roi).net })).filter(({ i }) => (tier === 'all' || effectiveTier(i) === tier) && (!needle || (i.name + ' ' + i.keywords.join(' ') + ' ' + i.description).toLowerCase().includes(needle)))
    return list.sort((a, b) => (sort === 'size' ? b.i.size - a.i.size : sort === 'score' ? b.i.score - a.i.score : b.v - a.v))
  }, [s, p.roi, q, tier, sort])

  const current = s.intents.find(i => i.id === open)
  const doMerge = async (name: string) => {
    setBusy(true)
    try { await merge(p.id, s.id, [...picked], name); setPicked(new Set()) } catch (e) { toast({ text: (e as Error).message, kind: 'error' }) }
    setBusy(false)
  }
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="intent-layout" style={{ gridTemplateColumns: current ? undefined : '1fr' }}>
      <div className="col" style={{ gap: 14, minWidth: 0 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input ref={search} className="input" style={{ maxWidth: 280 }} placeholder="Search intents  ( / )" value={q} onChange={e => setQ(e.target.value)} aria-label="Search intents" />
          <div className="seg" role="group" aria-label="Filter by verdict">
            {(['all', 'automatable', 'action', 'human'] as const).map(t => <button key={t} aria-pressed={tier === t} className={t} onClick={() => setTier(t)}>{t === 'all' ? 'All' : TIER_LABEL[t]}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Sort">
            {(['size', 'score', 'value'] as Sort[]).map(k => <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{k === 'size' ? 'Volume' : k === 'score' ? 'Score' : 'Value'}</button>)}
          </div>
          {picked.size >= 2 && <button className="btn sm primary" onClick={() => setMergeOpen(true)} disabled={busy || local === 'missing'}><Icon name="merge" size={15} />Merge {picked.size} <kbd>m</kbd></button>}
          {picked.size > 0 && <button className="linkish small" onClick={() => setPicked(new Set())}>Clear selection</button>}
        </div>
        <div className="card scroll-x" style={{ padding: 0 }}>
          <table className={`table ${current ? 'compact' : ''}`}>
            <thead><tr><th style={{ width: 36 }}><span className="sr">Select</span></th><th>Intent</th><th className="r">Tickets/mo</th><th className="r">Share</th><th className="r">Score</th><th>Verdict</th><th className="hide-sm">Help article</th><th className="r hide-sm">Value/mo</th></tr></thead>
            <tbody>
              {rows.map(({ i, v }) => (
                <tr key={i.id} className={`clickable ${open === i.id ? 'sel' : ''}`} onClick={e => { if (!(e.target as HTMLElement).closest('input')) setOpen(i.id === open ? null : i.id) }}>
                  <td><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} style={{ accentColor: 'var(--moss)' }} /></td>
                  <td style={{ maxWidth: 320 }}><div>{i.name}</div><div className="xs faint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.keywords.slice(0, 4).join(' · ')}</div></td>
                  <td className="r num">{fmtInt(monthlyVolume(i, s))}</td>
                  <td className="r num">{fmtPct(i.share, 1)}</td>
                  <td className="r num"><span style={{ color: tierColor(effectiveTier(i)) }}>{i.score}</span></td>
                  <td><TierBadge tier={effectiveTier(i)} overridden={!!i.override} /></td>
                  <td className="hide-sm">{i.kb ? <span className={`kb ${i.kb.status}`}>{i.kb.status === 'gap' ? 'Gap' : i.kb.status === 'partial' ? 'Partial' : 'Covered'}</span> : <span className="xs faint">—</span>}</td>
                  <td className="r num hide-sm">{fmtMoney(v)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted small" style={{ textAlign: 'center', padding: 32 }}>No intents match.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="xs faint">Select two or more to merge. Open one to rename, split, see why it scored as it did, or override the verdict.</p>
      </div>
      {current && <Drawer key={current.id} p={p} s={s} it={current} local={local} onClose={() => setOpen(null)} />}
      {mergeOpen && <MergeModal names={[...picked].map(id => s.intents.find(i => i.id === id)!).filter(Boolean)} onClose={() => setMergeOpen(false)} onMerge={doMerge} />}
    </div>
  )
}

function MergeModal({ names, onClose, onMerge }: { names: Intent[]; onClose: () => void; onMerge: (n: string) => void }) {
  const [n, setN] = useState(names.sort((a, b) => b.size - a.size)[0]?.name ?? '')
  return (
    <Modal title={`Merge ${names.length} intents`} onClose={onClose}>
      <form className="col" onSubmit={e => { e.preventDefault(); onMerge(n.trim() || names[0].name); onClose() }}>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{names.map(i => <li key={i.id}>{i.name} · {fmtInt(i.size)} tickets</li>)}</ul>
        <label className="field">Name for the merged intent<input className="input" value={n} onChange={e => setN(e.target.value)} /></label>
        <p className="xs faint">Scores, examples and the map are recomputed from the combined tickets. You can undo.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn sm" onClick={onClose}>Cancel</button><button className="btn sm primary">Merge</button></div>
      </form>
    </Modal>
  )
}

function Drawer({ p, s, it, local, onClose }: { p: Project; s: Snapshot; it: Intent; local: SnapshotLocal | null | 'missing'; onClose: () => void }) {
  const [edit, setEdit] = useState<'name' | 'desc' | null>(null)
  const [busy, setBusy] = useState(false)
  const L = local && local !== 'missing' ? local : null
  const idx = s.intents.indexOf(it)
  const members = useMemo(() => (L ? L.tickets.filter((_, i) => L.assign[i] === idx) : []), [L, idx])
  const outline = useMemo(() => answerOutline(it, members), [it, members])
  const v = intentValue(it, s, p.roi)
  const t = effectiveTier(it)
  const sig = it.signals
  return (
    <aside className="card drawer" aria-label={`Intent ${it.name}`}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Intent · {fmtInt(it.size)} tickets</span>
          <h3 style={{ marginTop: 8, cursor: 'text' }} onClick={() => setEdit('name')} title="Rename">{it.name} <span className="faint" style={{ display: 'inline-flex', verticalAlign: 'middle' }}><Icon name="edit" size={14} /></span></h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      <p className="small muted" style={{ marginTop: 8, cursor: 'text' }} onClick={() => setEdit('desc')}>{it.description}</p>

      <div className="row" style={{ marginTop: 18, gap: 16 }}>
        <ScoreRing score={it.score} tier={t} />
        <div className="col" style={{ gap: 6 }}>
          <TierBadge tier={t} overridden={!!it.override} />
          <span className="xs faint">Model: {TIER_LABEL[it.tier]} · {fmtMoney(v.net)}/mo at full ramp · {fmtInt(v.resolved)} resolved · {fmtInt(v.hours)} h</span>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="xs faint" style={{ marginBottom: 6 }}>Your verdict</div>
        <div className="seg" role="group" aria-label="Override verdict">
          <button aria-pressed={!it.override} onClick={() => setOverride(p, s, it.id, undefined)} title={`Model says: ${TIER_LABEL[it.tier]}`}>Model</button>
          {(['automatable', 'action', 'human'] as Tier[]).map(x => <button key={x} className={x} aria-pressed={it.override === x} onClick={() => setOverride(p, s, it.id, x)}>{x === 'automatable' ? 'Automatable' : x === 'action' ? 'Action API' : 'Human'}</button>)}
        </div>
      </div>

      <hr className="divider" />
      <h4>Why this score</h4>
      <div style={{ marginTop: 6 }}>
        {[...it.factors].sort((a, b) => b.weight - a.weight).map(f => (
          <div className="factor" key={f.key}>
            <span className="small">{f.label}</span>
            <span className="xs faint num" style={{ textAlign: 'right' }}>{Math.round(f.value * 100)} · w{Math.round(f.weight * 100)}</span>
            <div className="bar"><i style={{ width: `${f.value * 100}%`, background: f.value >= 0.6 ? 'var(--tier-auto)' : f.value >= 0.35 ? 'var(--tier-action)' : 'var(--tier-human)' }} /></div>
            <span className="xs muted" style={{ gridColumn: '1 / -1' }}>{f.detail}</span>
          </div>
        ))}
      </div>

      <hr className="divider" />
      <div className="grid2" style={{ gap: 10 }}>
        <Metric k="Median resolution" v={sig.medianHandle != null ? fmtMinutes(sig.medianHandle) : '—'} />
        <Metric k="Reopened" v={sig.reopenRate != null ? fmtPct(sig.reopenRate) : '—'} />
        <Metric k="Escalated" v={fmtPct(sig.escalationRate)} />
        <Metric k="Satisfaction" v={sig.csat != null ? fmtPct(sig.csat) : '—'} />
      </div>

      {it.actions.length > 0 && (<>
        <hr className="divider" />
        <h4>Actions an AI agent would need</h4>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 8 }}>{it.actions.map(a => { const x = ACTIONS.find(y => y.id === a)!; return <li key={a} style={{ marginBottom: 4 }}>{x.label} <span className="faint">· {x.api}</span></li> })}</ul>
      </>)}

      <hr className="divider" />
      <h4>Help article</h4>
      {it.kb ? <p className="small" style={{ marginTop: 6 }}><span className={`kb ${it.kb.status}`}>{it.kb.status === 'gap' ? 'No good match' : it.kb.status === 'partial' ? 'Partial match' : 'Covered'}</span> · {it.kb.url ? <a href={it.kb.url} target="_blank" rel="noreferrer">{it.kb.title}</a> : it.kb.title} <span className="faint mono xs">sim {it.kb.sim.toFixed(2)}</span></p> : <p className="small muted" style={{ marginTop: 6 }}>Import your help centre on the Knowledge tab to check coverage.</p>}

      <hr className="divider" />
      <div className="spread"><h4>Suggested answer outline</h4><button className="btn xs" onClick={() => copy(outline.map((x, i) => `${i + 1}. ${x}`).join('\n'), 'Outline copied')}><Icon name="copy" size={13} />Copy</button></div>
      <ol className="small muted" style={{ paddingLeft: 18, marginTop: 8 }}>{outline.map((x, i) => <li key={i} style={{ marginBottom: 4 }}>{x}</li>)}</ol>

      <hr className="divider" />
      <h4>How customers phrase it</h4>
      {L ? it.exampleIdx.map(i => L.tickets[i] && <div className="example" key={i}>{ticketText(L.tickets[i]).slice(0, 240)}</div>) : <p className="small muted" style={{ marginTop: 6 }}>Example tickets stay on the device that imported them.</p>}

      <hr className="divider" />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={busy || !L} onClick={async () => { setBusy(true); try { await split(p.id, s.id, it.id) } catch (e) { toast({ text: (e as Error).message, kind: 'error' }) } setBusy(false) }}>{busy ? <span className="spinner" /> : <Icon name="split" size={15} />}Split in two</button>
        <button className="btn sm" onClick={() => setEdit('name')}><Icon name="edit" size={15} />Rename</button>
      </div>
      {edit === 'name' && <RenameModal title="Rename intent" value={it.name} onClose={() => setEdit(null)} onSave={v => patchIntent(p, s, it.id, { name: v })} />}
      {edit === 'desc' && <RenameModal title="Edit description" multiline value={it.description} onClose={() => setEdit(null)} onSave={v => patchIntent(p, s, it.id, { description: v })} />}
    </aside>
  )
}

function Metric({ k, v }: { k: string; v: string }) {
  return <div className="well"><div className="xs faint">{k}</div><div className="num" style={{ fontSize: 18 }}>{v}</div></div>
}
