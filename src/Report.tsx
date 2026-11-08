import { useEffect, useMemo, useState } from 'react'
import { useProjects } from './lib/store.ts'
import type { Project } from './lib/db.ts'
import { effectiveTier, type Snapshot } from './engine/analyze.ts'
import { projectAll, intentValue, monthlyVolume, type RoiInputs } from './engine/roi.ts'
import { roadmap, compareSnapshots, WAVE_LABEL, type Wave } from './engine/outputs.ts'
import { TIER_LABEL, type Tier } from './engine/score.ts'
import { RoiChart, TierMeter } from './charts.tsx'
import { tierShares } from './ProjectView.tsx'
import { Icon, Link, TierBadge, fmtInt, fmtMoney, fmtPct, fmtPeriod, fmtDate, copy } from './ui.tsx'

interface ReportData { name: string; s: Snapshot; prev?: Snapshot; roi: RoiInputs; at: number }

async function pack(obj: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const buf = new Uint8Array(await new Response(stream).arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function unpack(str: string): Promise<any> {
  const b = Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return JSON.parse(await new Response(stream).text())
}

/** Strip bulky vectors; the shared report needs names, numbers and explanations only. */
const lean = (s: Snapshot): Snapshot => ({ ...s, kScores: [], intents: s.intents.map(i => ({ ...i, centroid: { s: 0, q: [] }, exampleIdx: [], signals: { ...i.signals, actions: [] } })) })

export async function shareUrl(p: Project, s: Snapshot) {
  const idx = p.snapshots.findIndex(x => x.id === s.id)
  const prev = idx > 0 && p.snapshots[idx - 1].catalogue === s.catalogue ? lean(p.snapshots[idx - 1]) : undefined
  return `${location.origin}/r#${await pack({ name: p.name, s: lean(s), prev, roi: p.roi, at: Date.now() } satisfies ReportData)}`
}

export default function ReportPage({ projectId, shared }: { projectId?: string; shared?: boolean }) {
  const { projects, loaded } = useProjects()
  const [data, setData] = useState<ReportData | null | 'bad'>(null)
  useEffect(() => {
    if (!shared) return
    const h = location.hash.slice(1)
    if (!h) { setData('bad'); return }
    unpack(h).then(setData).catch(() => setData('bad'))
  }, [shared])

  const p = projectId ? projects.find(x => x.id === projectId) : undefined
  const local: ReportData | null = useMemo(() => {
    if (!p) return null
    const s = p.snapshots.find(x => x.id === p.activeSnapshot) ?? p.snapshots[p.snapshots.length - 1]
    if (!s) return null
    const idx = p.snapshots.indexOf(s)
    const prev = idx > 0 && p.snapshots[idx - 1].catalogue === s.catalogue ? p.snapshots[idx - 1] : undefined
    return { name: p.name, s, prev, roi: p.roi, at: Date.now() }
  }, [p])

  const d = shared ? data : local
  if (shared && data === 'bad') return <main className="narrow app-main"><div className="empty"><h2>This report link is incomplete</h2><p className="muted" style={{ marginTop: 12 }}>Ask the sender to copy the share link again.</p><div className="ctas"><Link to="/" className="btn">What is this?</Link></div></div></main>
  if (!d || d === 'bad') return <main className="narrow app-main">{!shared && loaded && !p ? <div className="empty"><h2>Project not found</h2><div className="ctas"><Link to="/app" className="btn primary">Projects</Link></div></div> : <div className="skeleton" style={{ height: 600 }} />}</main>
  return (
    <main className="wrap app-main">
      <div className="spread no-print" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        {shared ? <span className="small muted">Shared report · read-only · <Link to="/">Make your own</Link></span> : <Link to={`/app/p/${projectId}`} className="linkish small">← Back to project</Link>}
        <div className="row">
          {!shared && p && <button className="btn sm" onClick={async () => copy(await shareUrl(p, d.s), 'Share link copied. Report only, no ticket text.')}><Icon name="share" size={15} />Copy share link</button>}
          <button className="btn sm primary" onClick={() => print()}><Icon name="print" size={15} />Print / Save PDF</button>
        </div>
      </div>
      <Report d={d} />
    </main>
  )
}

function Report({ d }: { d: ReportData }) {
  const { s, roi } = d
  const pr = useMemo(() => projectAll(s, roi), [s, roi])
  const items = useMemo(() => roadmap(s, roi), [s, roi])
  const b = pr.base, c = pr.conservative, o = pr.optimistic
  const monthly = s.total / s.months
  const shares = tierShares(s)
  const top = items.filter(i => i.wave !== 'human').sort((a, b2) => b2.value - a.value).slice(0, 8)
  const gaps = s.intents.filter(i => i.kb && i.kb.status === 'gap' && effectiveTier(i) !== 'human' && i.share >= 0.01).sort((a, b2) => b2.size - a.size).slice(0, 6)
  const moved = d.prev ? compareSnapshots(d.prev, s).filter(r => r.status === 'both' && r.delta < -0.005).slice(0, 4) : []
  const pb = (x: number | null) => (x == null ? `more than ${roi.horizonMonths} months` : `${x.toFixed(1)} months`)
  return (
    <article className="report">
      <header className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">Automation Opportunity Report</span>
          <h1 style={{ marginTop: 12 }}>{d.name}</h1>
          <p className="small muted" style={{ marginTop: 8 }}>{s.label} · {fmtInt(s.total)} tickets · {fmtPeriod(s.periodStart, s.periodEnd)} · prepared {fmtDate(d.at)}</p>
        </div>
        <span className="mono-badge" style={{ width: 40, height: 40, borderRadius: 12, fontSize: 15 }}>AR</span>
      </header>

      <section style={{ marginTop: 32 }}>
        <p className="lead" style={{ color: 'var(--ink-1)', fontSize: 22, letterSpacing: '-0.01em' }}>
          An AI agent could resolve about <b style={{ fontWeight: 500, color: 'var(--tier-auto)' }}>{fmtPct(b.fullRamp.share)}</b> of the {fmtInt(monthly)} tickets you receive each month (range {fmtPct(c.fullRamp.share)}–{fmtPct(o.fullRamp.share)}), saving roughly <b style={{ fontWeight: 500 }}>{fmtInt(b.fullRamp.hours)} agent hours</b> and <b style={{ fontWeight: 500 }}>{fmtMoney(b.fullRamp.net)}</b> net per month at full ramp. On a {fmtMoney(roi.setupCost)} setup, payback comes in {pb(b.paybackMonth)}.
        </p>
      </section>

      <section style={{ marginTop: 28 }}>
        <div className="kpis">
          <div className="kpi"><span className="xs faint">Resolvable share</span><b style={{ color: 'var(--tier-auto)' }}>{fmtPct(b.fullRamp.share)}</b><span className="range">{fmtPct(c.fullRamp.share)} – {fmtPct(o.fullRamp.share)}</span></div>
          <div className="kpi"><span className="xs faint">Hours saved / mo</span><b>{fmtInt(b.fullRamp.hours)}</b><span className="range">{fmtInt(c.fullRamp.hours)} – {fmtInt(o.fullRamp.hours)}</span></div>
          <div className="kpi"><span className="xs faint">Net, first {roi.horizonMonths} mo</span><b>{fmtMoney(b.totalNet - roi.setupCost)}</b><span className="range">after {fmtMoney(roi.setupCost)} setup</span></div>
          <div className="kpi"><span className="xs faint">Payback</span><b>{b.paybackMonth == null ? '—' : `${b.paybackMonth.toFixed(1)} mo`}</b><span className="range">{o.paybackMonth?.toFixed(1) ?? '—'} – {c.paybackMonth?.toFixed(1) ?? '—'} mo</span></div>
        </div>
      </section>

      <section>
        <h2>Where the volume sits</h2>
        <TierMeter parts={shares} />
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 10, gap: 8 }}>{shares.map(x => <span key={x.tier} className="chip"><span className="sw" style={{ background: `var(--tier-${x.tier === 'automatable' ? 'auto' : x.tier})` }} />{TIER_LABEL[x.tier as Tier]} · {fmtPct(x.share)} of tickets</span>)}</div>
      </section>

      <section>
        <h2>Top opportunities</h2>
        <div className="scroll-x"><table className="table"><thead><tr><th>Intent</th><th className="r">Tickets/mo</th><th>Verdict</th><th className="r">Score</th><th>Help article</th><th className="r">Net/mo</th></tr></thead>
          <tbody>{top.map(it => <tr key={it.intent.id}><td>{it.intent.name}</td><td className="r num">{fmtInt(monthlyVolume(it.intent, s))}</td><td><TierBadge tier={effectiveTier(it.intent)} /></td><td className="r num">{it.intent.score}</td><td>{it.intent.kb ? <span className={`kb ${it.intent.kb.status}`}>{it.intent.kb.status}</span> : <span className="faint">—</span>}</td><td className="r num">{fmtMoney(intentValue(it.intent, s, roi).net)}</td></tr>)}</tbody></table></div>
      </section>

      <section>
        <h2>Cumulative net savings</h2>
        <RoiChart c={c} b={b} o={o} setup={roi.setupCost} />
      </section>

      <section>
        <h2>Roadmap</h2>
        <div className="grid3">
          {(['now', 'next', 'later'] as Wave[]).map(w => (
            <div key={w} className="card tight" style={{ background: 'var(--surface-2)' }}>
              <span className="eyebrow">{WAVE_LABEL[w]}</span>
              <ul className="small" style={{ paddingLeft: 18, margin: '10px 0 0' }}>{items.filter(i => i.wave === w).slice(0, 6).map(i => <li key={i.intent.id} style={{ marginBottom: 4 }}>{i.intent.name}</li>)}{!items.some(i => i.wave === w) && <li className="faint">Nothing here</li>}</ul>
            </div>
          ))}
        </div>
      </section>

      {gaps.length > 0 && (
        <section>
          <h2>Knowledge gaps to close first</h2>
          <ul className="small muted" style={{ paddingLeft: 18 }}>{gaps.map(i => <li key={i.id} style={{ marginBottom: 4 }}><span style={{ color: 'var(--ink-1)' }}>{i.name}</span> · {fmtInt(monthlyVolume(i, s))} tickets/mo with no matching help article</li>)}</ul>
        </section>
      )}

      {moved.length > 0 && d.prev && (
        <section>
          <h2>Since {d.prev.label}</h2>
          <ul className="small muted" style={{ paddingLeft: 18 }}>{moved.map(r => <li key={r.id} style={{ marginBottom: 4 }}><span style={{ color: 'var(--ink-1)' }}>{r.name}</span> fell from {fmtPct(r.shareA, 1)} to {fmtPct(r.shareB, 1)} of tickets ({(r.delta * 100).toFixed(1)} pts)</li>)}</ul>
        </section>
      )}

      <section>
        <h2>Method and assumptions</h2>
        <div className="grid2 small muted" style={{ gap: 24 }}>
          <div>
            <p><b style={{ color: 'var(--ink-1)', fontWeight: 500 }}>Resolved</b> means a request answered without escalating to a person, not merely a conversation that ended without a handoff.</p>
            <p style={{ marginTop: 10 }}>Intents were discovered from {fmtInt(s.total)} redacted tickets with {s.embedder === 'minilm' ? 'all-MiniLM-L6-v2 sentence embeddings' : 'lexical embeddings'} and seeded k-means. Each intent’s automatability score combines repetition, information vs account action, agent answer consistency, reopens, time to resolve, sentiment and escalations; verdicts marked “set by you” were overridden by the team.</p>
          </div>
          <div>
            <p>Cost per human-handled ticket {fmtMoney(roi.costPerTicket, false)} · {roi.minutesPerTicket} agent minutes per ticket · AI price {fmtMoney(roi.pricePerResolution, false)} per resolution (entered by the team) · platform fee {fmtMoney(roi.monthlyPlatformFee, false)}/mo · setup {fmtMoney(roi.setupCost, false)} · {roi.rampMonths}-month ramp.</p>
            <p style={{ marginTop: 10 }}>Full-ramp resolution rates: automatable {fmtPct(roi.tierRates.automatable)}, needs action API {fmtPct(roi.tierRates.action)}, human only {fmtPct(roi.tierRates.human)}; conservative ×0.6, optimistic ×1.25. Ticket text was processed in the browser and is not part of this report.</p>
          </div>
        </div>
      </section>
    </article>
  )
}
