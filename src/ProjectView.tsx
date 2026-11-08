import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { useProjects, getLocal, saveProject, toast } from './lib/store.ts'
import type { Project, SnapshotLocal } from './lib/db.ts'
import { deleteSnapshot, exportAll } from './lib/actions.ts'
import { effectiveTier, type Snapshot } from './engine/analyze.ts'
import { projectAll, intentValue, monthlyVolume } from './engine/roi.ts'
import { roadmap, catalogue, catalogueCsv, compareSnapshots, WAVE_LABEL, type Wave, type RoadmapItem } from './engine/outputs.ts'
import { TIER_LABEL, type Tier } from './engine/score.ts'
import { ticketText } from './engine/lexical.ts'
import { ClusterMap, type MapData } from './ClusterMap.tsx'
import { OpportunityMatrix, DeltaBars, TierMeter } from './charts.tsx'
import { Icon, Link, navigate, TierBadge, fmtInt, fmtMoney, fmtPct, fmtPeriod, download, copy, slug, ago } from './ui.tsx'
import { RenameModal } from './Workspace.tsx'
import { shareUrl } from './Report.tsx'

const Intents = lazy(() => import('./Intents.tsx'))
const RoiTab = lazy(() => import('./RoiTab.tsx'))
const Knowledge = lazy(() => import('./Knowledge.tsx'))

const TABS = [['overview', 'Overview'], ['intents', 'Intents'], ['knowledge', 'Knowledge'], ['roi', 'ROI'], ['roadmap', 'Roadmap'], ['compare', 'Compare'], ['export', 'Export']] as const

export function useLocalData(id: string | undefined, version: unknown) {
  const [d, setD] = useState<SnapshotLocal | null | 'missing'>(null)
  useEffect(() => {
    let live = true
    setD(null)
    if (id) getLocal(id).then(v => live && setD(v ?? 'missing'))
    return () => { live = false }
  }, [id, version])
  return d
}

export function mapData(s: Snapshot, l: SnapshotLocal): MapData {
  return { x: l.x, y: l.y, assign: l.assign, centers: l.centers, names: s.intents.map(i => i.name), tiers: s.intents.map(effectiveTier) }
}

export default function ProjectView({ id, tab }: { id: string; tab: string }) {
  const { projects, loaded } = useProjects()
  const p = projects.find(x => x.id === id)
  const s = p ? p.snapshots.find(x => x.id === p.activeSnapshot) ?? p.snapshots[p.snapshots.length - 1] : undefined
  const local = useLocalData(s?.id, s)
  const [rename, setRename] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      const n = +e.key
      if (n >= 1 && n <= TABS.length) navigate(`/app/p/${id}/${TABS[n - 1][0]}`, true)
      else if (e.key === 'i') navigate(`/app/p/${id}/import`)
      else if (e.key === 'p') navigate(`/app/p/${id}/report`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  if (!loaded) return <main className="wrap app-main"><div className="skeleton" style={{ height: 420 }} /></main>
  if (!p) return <main className="wrap app-main"><div className="empty"><span className="eyebrow">Not found</span><h2 style={{ marginTop: 12 }}>This project isn’t on this device</h2><p className="muted" style={{ marginTop: 12 }}>It may have been deleted, or it lives in an account you are not signed in to.</p><div className="ctas"><Link to="/app" className="btn primary">Back to projects</Link></div></div></main>

  return (
    <main className="wrap app-main">
      <div className="crumbs"><Link to="/app">Projects</Link><span>/</span><span>{p.name}</span></div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ cursor: 'text' }} onClick={() => setRename(true)} title="Rename">{p.name}</h1>
          {s && <p className="small muted" style={{ marginTop: 8 }}>{fmtInt(s.total)} tickets · {fmtPeriod(s.periodStart, s.periodEnd)} · {s.embedder === 'minilm' ? 'MiniLM embeddings' : 'lexical embeddings'} · {s.source.fileName}</p>}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {p.snapshots.length > 0 && (
            <select className="input" style={{ width: 'auto', maxWidth: 280, height: 34, borderRadius: 999 }} aria-label="Snapshot" value={s?.id} onChange={e => saveProject({ ...p, activeSnapshot: e.target.value })}>
              {p.snapshots.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          )}
          <Link to={`/app/p/${p.id}/import`} className="btn sm" title="New import (i)"><Icon name="upload" size={15} />New import</Link>
          {s && <Link to={`/app/p/${p.id}/report`} className="btn primary sm" title="Report (p)"><Icon name="doc" size={15} />Executive report</Link>}
        </div>
      </div>
      {!s ? (
        <div className="empty"><h2>No tickets yet</h2><p className="muted" style={{ marginTop: 12 }}>Import an export to build the first snapshot.</p><div className="ctas"><Link to={`/app/p/${p.id}/import`} className="btn primary">Import tickets</Link></div></div>
      ) : (
        <>
          <div className="tabs" role="tablist" style={{ marginBottom: 28 }}>
            {TABS.map(([k, l], i) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => navigate(`/app/p/${p.id}/${k}`, true)}>{l}<kbd className="hide-sm">{i + 1}</kbd></button>)}
          </div>
          <Suspense fallback={<div className="skeleton" style={{ height: 400 }} />}>
            {tab === 'overview' && <Overview p={p} s={s} local={local} />}
            {tab === 'intents' && <Intents p={p} s={s} local={local} />}
            {tab === 'knowledge' && <Knowledge p={p} s={s} />}
            {tab === 'roi' && <RoiTab p={p} s={s} />}
            {tab === 'roadmap' && <Roadmap p={p} s={s} />}
            {tab === 'compare' && <Compare p={p} s={s} />}
            {tab === 'export' && <ExportTab p={p} s={s} local={local} />}
            {!TABS.some(t => t[0] === tab) && <p className="muted">Unknown tab. <Link to={`/app/p/${p.id}`}>Go to overview</Link></p>}
          </Suspense>
        </>
      )}
      {rename && <RenameModal title="Rename project" value={p.name} onClose={() => setRename(false)} onSave={v => saveProject({ ...p, name: v })} />}
    </main>
  )
}

export function tierShares(s: Snapshot) {
  return (['automatable', 'action', 'human'] as Tier[]).map(t => ({ tier: t, share: s.intents.filter(i => effectiveTier(i) === t).reduce((a, i) => a + i.share, 0) }))
}

export function Kpis({ p, s }: { p: Project; s: Snapshot }) {
  const pr = useMemo(() => projectAll(s, p.roi), [s, p.roi])
  const { conservative: c, base: b, optimistic: o } = pr
  const pb = (x: number | null) => (x == null ? `>${p.roi.horizonMonths} mo` : `${x.toFixed(1)} mo`)
  return (
    <div className="kpis">
      <div className="kpi"><span className="xs faint">AI could resolve</span><b style={{ color: 'var(--tier-auto)' }}>{fmtPct(b.fullRamp.share)}</b><span className="range">{fmtPct(c.fullRamp.share)} – {fmtPct(o.fullRamp.share)} · {fmtInt(b.fullRamp.resolved)} tickets/mo</span></div>
      <div className="kpi"><span className="xs faint">Agent hours saved / mo</span><b>{fmtInt(b.fullRamp.hours)}</b><span className="range">{fmtInt(c.fullRamp.hours)} – {fmtInt(o.fullRamp.hours)} at full ramp</span></div>
      <div className="kpi"><span className="xs faint">Net savings, first {p.roi.horizonMonths} mo</span><b>{fmtMoney(b.monthly[b.monthly.length - 1].cumulative + p.roi.setupCost)}</b><span className="range">{fmtMoney(c.totalNet)} – {fmtMoney(o.totalNet)} before setup cost</span></div>
      <div className="kpi"><span className="xs faint">Payback</span><b>{pb(b.paybackMonth)}</b><span className="range">{pb(o.paybackMonth)} – {pb(c.paybackMonth)} · setup {fmtMoney(p.roi.setupCost)}</span></div>
    </div>
  )
}

function Overview({ p, s, local }: { p: Project; s: Snapshot; local: SnapshotLocal | null | 'missing' }) {
  const items = useMemo(() => roadmap(s, p.roi), [s, p.roi])
  const [sel, setSel] = useState<number | null>(null)
  const md = useMemo(() => (local && local !== 'missing' ? mapData(s, local) : null), [s, local])
  const tip = useMemo(() => (local && local !== 'missing' ? (i: number) => ticketText(local.tickets[i]).slice(0, 160) : undefined), [local])
  const shares = tierShares(s)
  return (
    <div className="col" style={{ gap: 20 }}>
      <Kpis p={p} s={s} />
      <div className="card tight">
        <div className="spread" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="small">Share of ticket volume by verdict</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>{shares.map(x => <span key={x.tier} className="chip"><span className="sw" style={{ background: `var(--tier-${x.tier === 'automatable' ? 'auto' : x.tier})` }} />{TIER_LABEL[x.tier]} {fmtPct(x.share)}</span>)}</div>
        </div>
        <TierMeter parts={shares} />
      </div>
      <div className="two">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="spread" style={{ padding: '16px 20px' }}><h4>Intent map</h4><span className="xs faint">{s.intents.length} intents · click a cluster</span></div>
          <div className="mapbox" style={{ borderRadius: 0, border: 0, borderTop: '1px solid var(--line)' }}>
            {md ? <ClusterMap data={md} born={undefined} selected={sel} onSelect={setSel} tooltip={tip} labelMin={0.035} /> :
              local === 'missing' ? <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24, textAlign: 'center' }} className="small muted">Ticket-level data stays on the device that imported it. This synced copy has the report, not the tickets.</div> : <div className="skeleton" style={{ position: 'absolute', inset: 20 }} />}
          </div>
          {sel != null && s.intents[sel] && <div className="spread" style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}><span className="small">{s.intents[sel].name} · {fmtInt(s.intents[sel].size)} tickets</span><Link to={`/app/p/${p.id}/intents?i=${s.intents[sel].id}`} className="btn xs">Open intent</Link></div>}
        </div>
        <div className="card">
          <div className="spread"><h4>Top opportunities</h4><Link to={`/app/p/${p.id}/roadmap`} className="linkish small">Full roadmap</Link></div>
          <div className="col" style={{ gap: 0, marginTop: 8 }}>
            {items.filter(i => i.wave !== 'human').slice(0, 7).sort((a, b) => b.value - a.value).map(it => (
              <Link key={it.intent.id} to={`/app/p/${p.id}/intents?i=${it.intent.id}`} className="spread" style={{ padding: '12px 0', borderBottom: '1px solid var(--hair)', textDecoration: 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.intent.name}</div>
                  <div className="xs faint">{fmtInt(monthlyVolume(it.intent, s))}/mo · {WAVE_LABEL[it.wave].split(' · ')[0]}{it.blockers.length ? ` · ${it.blockers[0]}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}><div className="small num" style={{ color: 'var(--tier-auto)' }}>{fmtMoney(it.value)}/mo</div><TierBadge tier={effectiveTier(it.intent)} /></div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="spread"><h4>Opportunity matrix</h4><span className="xs faint">bubble size = monthly net value (base)</span></div>
        <OpportunityMatrix items={s.intents.map(i => ({ id: i.id, name: i.name, score: i.score, volume: monthlyVolume(i, s), value: intentValue(i, s, p.roi).net, tier: effectiveTier(i) }))} onSelect={id => navigate(`/app/p/${p.id}/intents?i=${id}`)} />
      </div>
      {s.embedder === 'lexical' && <p className="small" style={{ color: 'var(--tier-action)' }}>This snapshot used the offline lexical embedder, so intents group by shared words rather than meaning. Switch to MiniLM in Settings and re-import for better clusters.</p>}
    </div>
  )
}

export function roadmapMarkdown(p: Project, s: Snapshot, items: RoadmapItem[]) {
  const waves: Wave[] = ['now', 'next', 'later', 'human']
  let md = `# Automation roadmap: ${p.name}\n\nSnapshot: ${s.label} (${fmtInt(s.total)} tickets). Values are base-case monthly net savings at full ramp.\n`
  for (const w of waves) {
    const list = items.filter(i => i.wave === w)
    if (!list.length) continue
    md += `\n## ${WAVE_LABEL[w]}\n`
    for (const it of list) md += `\n### ${it.intent.name} (${fmtInt(monthlyVolume(it.intent, s))}/mo, ${TIER_LABEL[effectiveTier(it.intent)]}, ${fmtMoney(it.value, false)}/mo)\n${it.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n`
  }
  return md
}

function Roadmap({ p, s }: { p: Project; s: Snapshot }) {
  const items = useMemo(() => roadmap(s, p.roi), [s, p.roi])
  const md = () => roadmapMarkdown(p, s, items)
  return (
    <div>
      <div className="spread" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <p className="muted small" style={{ maxWidth: 640 }}>Ordered by readiness, then by monthly value. “Now” needs no new integrations or articles. Override any verdict on the Intents tab and the plan updates.</p>
        <div className="row"><button className="btn sm" onClick={() => copy(md(), 'Roadmap copied as Markdown')}><Icon name="copy" size={15} />Copy Markdown</button><button className="btn sm" onClick={() => download(`${slug(p.name)}-roadmap.md`, md(), 'text/markdown')}><Icon name="download" size={15} />Download</button></div>
      </div>
      {(['now', 'next', 'later', 'human'] as Wave[]).map(w => {
        const list = items.filter(i => i.wave === w)
        if (!list.length) return null
        const total = list.reduce((a, i) => a + i.value, 0)
        return (
          <section className="wave" key={w} style={{ marginTop: 28 }}>
            <div className="spread"><h3>{WAVE_LABEL[w]}</h3>{w !== 'human' && <span className="small num" style={{ color: 'var(--tier-auto)' }}>{fmtMoney(total)}/mo combined</span>}</div>
            {list.map(it => (
              <div className="road-item" key={it.intent.id}>
                <div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}><Link to={`/app/p/${p.id}/intents?i=${it.intent.id}`} style={{ textDecoration: 'none', fontWeight: 500 }}>{it.intent.name}</Link><TierBadge tier={effectiveTier(it.intent)} overridden={!!it.intent.override} />{it.intent.kb && <span className={`kb ${it.intent.kb.status}`}>{it.intent.kb.status === 'gap' ? 'No article' : it.intent.kb.status === 'partial' ? 'Weak article' : 'Article covers it'}</span>}</div>
                  <ol>{it.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontSize: 20 }}>{w === 'human' ? '—' : fmtMoney(it.value)}</div>
                  <div className="xs faint">{fmtInt(monthlyVolume(it.intent, s))} tickets/mo{w !== 'human' ? ` · ${fmtInt(it.hours)} h saved` : ''}</div>
                </div>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function Compare({ p, s }: { p: Project; s: Snapshot }) {
  const idx = p.snapshots.findIndex(x => x.id === s.id)
  const [aId, setA] = useState(idx > 0 ? p.snapshots[idx - 1].id : s.id)
  const [bId, setB] = useState(idx > 0 ? s.id : p.snapshots[1]?.id)
  const a = p.snapshots.find(x => x.id === aId), b = p.snapshots.find(x => x.id === bId)
  const rows = useMemo(() => (a && b && a.id !== b.id ? compareSnapshots(a, b) : []), [a, b])
  if (p.snapshots.length < 2) return (
    <div className="empty"><span className="eyebrow">Compare</span><h2 style={{ marginTop: 12 }}>Did automation shrink a topic?</h2><p className="muted" style={{ maxWidth: 560, margin: '14px auto 0' }}>Import next month’s export into this project with “Keep my intent catalogue” on, and this view shows how each intent’s share of the queue moved.</p><div className="ctas"><Link to={`/app/p/${p.id}/import`} className="btn primary">Import another month</Link></div></div>
  )
  const same = a && b && a.catalogue === b.catalogue
  const drops = rows.filter(r => r.delta < -0.005 && r.status === 'both').slice(0, 3)
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="field" style={{ minWidth: 220 }}>Before<select className="input" value={aId} onChange={e => setA(e.target.value)}>{p.snapshots.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="field" style={{ minWidth: 220 }}>After<select className="input" value={bId} onChange={e => setB(e.target.value)}>{p.snapshots.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      </div>
      {a && b && a.id === b.id ? <p className="muted">Pick two different snapshots.</p> : a && b && (
        <>
          {!same && <p className="small" style={{ color: 'var(--tier-action)' }}>These snapshots were clustered separately, so intents are matched by meaning (centroid similarity ≥ 0.8). For exact tracking, import with “Keep my intent catalogue”.</p>}
          <div className="grid3">
            {drops.length ? drops.map(r => (
              <div className="card" key={r.id}><span className="eyebrow">Shrank</span><h3 style={{ marginTop: 10, fontSize: 20 }}>{r.name}</h3><p className="num" style={{ fontSize: 30, marginTop: 8, color: 'var(--tier-auto)' }}>−{(Math.abs(r.delta) * 100).toFixed(1)} pts</p><p className="xs faint">{fmtPct(r.shareA, 1)} → {fmtPct(r.shareB, 1)} of tickets · {fmtInt(r.monthlyA)} → {fmtInt(r.monthlyB)}/mo</p></div>
            )) : <p className="muted">No intent shrank meaningfully between these snapshots.</p>}
          </div>
          <div className="card"><div className="spread" style={{ marginBottom: 12 }}><h4>Change in share of tickets</h4><span className="xs faint">{a.label} → {b.label}</span></div><DeltaBars rows={rows} /></div>
          <div className="card scroll-x">
            <table className="table"><thead><tr><th>Intent</th><th>Verdict</th><th className="r">Before</th><th className="r">After</th><th className="r">Change</th><th className="r">Tickets/mo</th></tr></thead>
              <tbody>{rows.map(r => <tr key={r.id + r.status}><td>{r.name}{r.status !== 'both' && <span className="chip" style={{ marginLeft: 8 }}>{r.status}</span>}</td><td className="small muted">{r.tier}</td><td className="r num">{fmtPct(r.shareA, 1)}</td><td className="r num">{fmtPct(r.shareB, 1)}</td><td className="r num" style={{ color: r.delta < 0 ? 'var(--tier-auto)' : r.delta > 0 ? 'var(--tier-human)' : undefined }}>{r.delta > 0 ? '+' : ''}{(r.delta * 100).toFixed(1)}</td><td className="r num">{fmtInt(r.monthlyA)} → {fmtInt(r.monthlyB)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ExportTab({ p, s, local }: { p: Project; s: Snapshot; local: SnapshotLocal | null | 'missing' }) {
  const L = local && local !== 'missing' ? local : null
  const cat = () => catalogue(s, L?.tickets ?? null, L?.assign ?? null)
  const name = slug(p.name)
  const share = async () => copy(await shareUrl(p, s), 'Share link copied. It contains the report only, no ticket text.')
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="grid2">
        <div className="card output-card">
          <span className="ico" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--moss)' }}><Icon name="list" /></span>
          <h3 style={{ fontSize: 20 }}>Intent catalogue</h3>
          <p className="small muted">Name, description, tier, example customer phrasings, a suggested answer outline and required actions/APIs per intent. Ready to seed an AI agent’s knowledge and actions.{!L && ' Example phrasings and outlines need the ticket data on this device.'}</p>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 'auto' }}>
            <button className="btn sm primary" onClick={() => download(`${name}-intent-catalogue.csv`, catalogueCsv(cat()), 'text/csv')}><Icon name="download" size={15} />CSV</button>
            <button className="btn sm" onClick={() => download(`${name}-intent-catalogue.json`, JSON.stringify(cat(), null, 2), 'application/json')}><Icon name="download" size={15} />JSON</button>
            <button className="btn sm" onClick={() => copy(JSON.stringify(cat(), null, 2), 'Catalogue JSON copied')}><Icon name="copy" size={15} />Copy JSON</button>
          </div>
        </div>
        <div className="card output-card">
          <span className="ico" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--moss)' }}><Icon name="doc" /></span>
          <h3 style={{ fontSize: 20 }}>Executive report</h3>
          <p className="small muted">One printable page for your VP: automatable share, hours and dollars with a range, payback, top opportunities and gaps. The share link encodes the report in the URL; no ticket text, no server.</p>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 'auto' }}>
            <Link to={`/app/p/${p.id}/report`} className="btn sm primary"><Icon name="print" size={15} />Open and print</Link>
            <button className="btn sm" onClick={share}><Icon name="share" size={15} />Copy share link</button>
          </div>
        </div>
        <div className="card output-card">
          <span className="ico" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--moss)' }}><Icon name="route" /></span>
          <h3 style={{ fontSize: 20 }}>Roadmap</h3>
          <p className="small muted">Now / next / later with the concrete steps per intent, as Markdown for Notion, Confluence or a ticket.</p>
          <div className="row" style={{ marginTop: 'auto' }}><button className="btn sm" onClick={() => download(`${name}-roadmap.md`, roadmapMarkdown(p, s, roadmap(s, p.roi)), 'text/markdown')}><Icon name="download" size={15} />Markdown</button></div>
        </div>
        <div className="card output-card">
          <span className="ico" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--moss)' }}><Icon name="shield" /></span>
          <h3 style={{ fontSize: 20 }}>Full backup</h3>
          <p className="small muted">Every project on this device, including redacted tickets and embeddings, as one JSON file. Restore it from Settings.</p>
          <div className="row" style={{ marginTop: 'auto' }}><button className="btn sm" onClick={async () => download(`automation-report-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(), 'application/json')}><Icon name="download" size={15} />Backup JSON</button></div>
        </div>
      </div>
      <div className="card">
        <h4>Snapshots</h4>
        <table className="table" style={{ marginTop: 10 }}><thead><tr><th>Label</th><th>Period</th><th className="r">Tickets</th><th className="hide-sm">Source</th><th className="hide-sm">Imported</th><th /></tr></thead>
          <tbody>{p.snapshots.map(x => <tr key={x.id}><td>{x.label}{x.id === s.id && <span className="chip" style={{ marginLeft: 8 }}>viewing</span>}</td><td className="small muted">{fmtPeriod(x.periodStart, x.periodEnd)}</td><td className="r num">{fmtInt(x.total)}</td><td className="small muted hide-sm">{x.source.fileName}</td><td className="small muted hide-sm">{ago(x.createdAt)}</td><td className="r"><button className="icon-btn" aria-label={`Delete snapshot ${x.label}`} onClick={() => { deleteSnapshot(p, x.id); if (p.snapshots.length === 1) toast({ text: 'Project has no snapshots now' }) }}><Icon name="trash" size={15} /></button></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}
