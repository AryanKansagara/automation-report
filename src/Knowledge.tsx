import { useRef, useState } from 'react'
import type { Project } from './lib/db.ts'
import { attachArticles, fetchHelpCenter } from './lib/actions.ts'
import { toast } from './lib/store.ts'
import type { Progress } from './lib/pipeline.ts'
import { effectiveTier, type Snapshot } from './engine/analyze.ts'
import { parseArticles, helpCenterUrl, KB_THRESHOLDS } from './engine/kb.ts'
import { monthlyVolume } from './engine/roi.ts'
import { Icon, TierBadge, fmtInt, ago, copy } from './ui.tsx'

export default function Knowledge({ p, s }: { p: Project; s: Snapshot }) {
  const [host, setHost] = useState('')
  const [locale, setLocale] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const attach = async (articles: Awaited<ReturnType<typeof fetchHelpCenter>>, source: string) => {
    if (!articles.length) throw new Error('No published articles found')
    setBusy(`Embedding ${articles.length} articles`)
    await attachArticles(p.id, articles, source, (pr: Progress) => setBusy(`${pr.stage}${pr.detail ? ` · ${pr.detail}` : ''}`))
    toast({ text: `Matched ${articles.length} articles to ${s.intents.length} intents`, kind: 'ok' })
  }
  const fromApi = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!host.trim()) return
    setErr(''); setBusy('Fetching articles')
    try { await attach(await fetchHelpCenter(helpCenterUrl(host, locale.trim()), n => setBusy(`Fetched ${n} articles`)), `Zendesk Help Center · ${host.trim()}`) }
    catch (x) { setErr(/fetch/i.test((x as Error).message) ? 'The Help Center did not allow a browser request (private, or a CORS block). Export your articles as CSV or JSON and upload them instead.' : (x as Error).message) }
    setBusy(null)
  }
  const fromFile = async (f?: File) => {
    if (!f) return
    setErr(''); setBusy('Reading file')
    try { await attach(parseArticles(await f.text()), `File · ${f.name}`) } catch (x) { setErr((x as Error).message) }
    setBusy(null)
  }

  const gaps = s.intents.filter(i => i.kb && i.kb.status !== 'covered' && effectiveTier(i) !== 'human').sort((a, b) => b.size - a.size)
  const th = KB_THRESHOLDS[s.embedder]
  const brief = () => gaps.map((i, n) => `${n + 1}. ${i.name} (${fmtInt(monthlyVolume(i, s))} tickets/mo)\n   Customers ask about: ${i.keywords.slice(0, 5).join(', ')}\n   Closest existing article: ${i.kb?.title} (similarity ${i.kb?.sim.toFixed(2)})`).join('\n\n')

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="grid2">
        <form className="card col" onSubmit={fromApi}>
          <h4>Fetch a public Zendesk Help Center</h4>
          <p className="small muted">Uses the public Help Center API from your browser. Works for any public help centre, including custom domains.</p>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field grow">Subdomain or domain<input className="input" placeholder="acme  or  help.acme.com" value={host} onChange={e => setHost(e.target.value)} /></label>
            <label className="field" style={{ width: 110 }}>Locale<input className="input" placeholder="en-us" value={locale} onChange={e => setLocale(e.target.value)} /></label>
            <button className="btn primary" disabled={!!busy || !host.trim()}>Fetch</button>
          </div>
        </form>
        <div className="card col">
          <h4>Or upload an articles export</h4>
          <p className="small muted">CSV with <code className="mono">title</code>, <code className="mono">body</code>, <code className="mono">url</code> columns, the Help Center API JSON, or a JSON array of articles.</p>
          <div><button className="btn" onClick={() => file.current?.click()} disabled={!!busy}><Icon name="upload" size={16} />Choose file</button></div>
          <input ref={file} type="file" hidden accept=".csv,.json" onChange={e => void fromFile(e.target.files?.[0])} />
        </div>
      </div>
      {busy && <div className="card tight row" aria-live="polite"><span className="spinner" /><span className="small">{busy}</span></div>}
      {err && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{err}</p>}
      {p.kb && <p className="small muted">Attached: {p.kb.source} · {p.kb.count} articles · {ago(p.kb.fetchedAt)}. Matching uses embedding similarity (covered ≥ {th.covered}, partial ≥ {th.partial}).</p>}

      {s.intents.some(i => i.kb) ? (
        <>
          {gaps.length > 0 && (
            <div className="card">
              <div className="spread" style={{ flexWrap: 'wrap' }}><div><h4>Write these articles</h4><p className="small muted">Automatable intents with no or weak help content, by volume. Each one blocks or weakens automation.</p></div><button className="btn sm" onClick={() => copy(brief(), 'Article brief copied')}><Icon name="copy" size={15} />Copy content brief</button></div>
              <ol className="small" style={{ paddingLeft: 18, marginTop: 12 }}>{gaps.map(i => <li key={i.id} style={{ marginBottom: 6 }}>{i.name} <span className="faint">· {fmtInt(monthlyVolume(i, s))}/mo · closest “{i.kb!.title}” ({i.kb!.sim.toFixed(2)})</span></li>)}</ol>
            </div>
          )}
          <div className="card scroll-x" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Intent</th><th>Verdict</th><th>Best article</th><th className="r">Similarity</th><th>Coverage</th></tr></thead>
              <tbody>{[...s.intents].sort((a, b) => (a.kb?.sim ?? 0) - (b.kb?.sim ?? 0)).map(i => (
                <tr key={i.id}><td>{i.name}</td><td><TierBadge tier={effectiveTier(i)} /></td><td className="small">{i.kb?.url ? <a href={i.kb.url} target="_blank" rel="noreferrer">{i.kb.title}</a> : i.kb?.title ?? '—'}</td><td className="r num">{i.kb?.sim.toFixed(2) ?? '—'}</td><td>{i.kb && <span className={`kb ${i.kb.status}`}>{i.kb.status === 'gap' ? 'Gap' : i.kb.status === 'partial' ? 'Partial' : 'Covered'}</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ) : !busy && (
        <div className="empty"><span className="eyebrow">Knowledge gaps</span><h2 style={{ marginTop: 12, fontSize: 34 }}>An AI agent is only as good as its articles</h2><p className="muted" style={{ maxWidth: 540, margin: '12px auto 0' }}>Attach your help centre to see which intents have no article to answer from. Articles are embedded on this device with the same model as your tickets.</p></div>
      )}
    </div>
  )
}
