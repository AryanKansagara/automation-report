import { useMemo, useRef, useState } from 'react'
import { sniff, normalizeCsv, normalizeJson, FIELD_LABELS, FORMAT_LABELS, type Field, type FormatId, type Mapping, type Ticket, type ValidationReport } from './engine/formats.ts'
import type { CsvTable } from './engine/csv.ts'
import type { PiiKind } from './engine/redact.ts'
import { sampleNdjson, sampleFreshdeskCsv } from './engine/sample.ts'
import { getProject, getSettings, setSettings, useSettings, toast } from './lib/store.ts'
import { importSnapshot, newProject, periodLabel } from './lib/actions.ts'
import type { Progress } from './lib/pipeline.ts'
import { ProgressPanel } from './Workspace.tsx'
import { Icon, Link, navigate, fmtInt } from './ui.tsx'

type Step = 'file' | 'map' | 'review' | 'run'
const FIELDS: Field[] = ['id', 'subject', 'body', 'channel', 'createdAt', 'solvedAt', 'agentReplies', 'replies', 'reopens', 'csat', 'tags', 'escalated', 'handleMinutes', 'groupStations']
const PII_LABEL: Record<PiiKind, string> = { email: 'Emails', phone: 'Phone numbers', card: 'Card numbers', address: 'Addresses', name: 'Names', ip: 'IP addresses' }

export default function ImportPage({ projectId }: { projectId?: string }) {
  const existing = projectId ? getProject(projectId) : undefined
  const settings = useSettings()
  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [csv, setCsv] = useState<{ table: CsvTable; format: FormatId; mapping: Mapping } | null>(null)
  const [result, setResult] = useState<{ tickets: Ticket[]; report: ValidationReport } | null>(null)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [reuse, setReuse] = useState(settings.reuseCatalogue)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)

  if (projectId && !existing) return <main className="wrap app-main"><div className="empty"><h2>Project not found</h2><p className="muted" style={{ marginTop: 12 }}><Link to="/app">Back to projects</Link></p></div></main>

  const normalize = (t: string, c = csv) => {
    const opts = { addresses: getSettings().redactAddresses, names: getSettings().redactNames }
    const r = c ? normalizeCsv(c.table, c.mapping, c.format, opts) : normalizeJson(t, opts)
    setResult(r)
    setLabel(l => l || periodLabel(r.tickets, fileName || 'Import'))
    return r
  }

  const load = (t: string, fname: string) => {
    setErr('')
    if (!t.trim()) { setErr('That file is empty.'); return }
    setText(t); setFileName(fname)
    setName(n => n || fname.replace(/\.(csv|json|ndjson|txt)$/i, '').replace(/[-_]+/g, ' '))
    try {
      const s = sniff(t)
      if (s.kind === 'json') {
        setCsv(null)
        const r = normalizeJson(t, { addresses: getSettings().redactAddresses, names: getSettings().redactNames })
        if (!r.tickets.length) { setErr('No tickets found in that JSON. Expected a Zendesk export (one ticket per line) or Intercom conversations.'); return }
        setResult(r); setLabel(periodLabel(r.tickets, fname)); setStep('review')
      } else {
        if (s.table.header.length < 2) { setErr('This does not look like a CSV with a header row.'); return }
        setCsv(s); setStep('map')
      }
    } catch (e) { setErr(`Could not read the file: ${(e as Error).message}`) }
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 200e6) { setErr('Files over 200 MB are too large for the browser. Export a shorter date range.'); return }
    load(await f.text(), f.name)
  }

  const run = async () => {
    if (!result) return
    setStep('run')
    try {
      const project = existing ?? newProject(name.trim() || 'Untitled project')
      const p = await importSnapshot({ project, tickets: result.tickets, report: result.report, fileName, label: label || 'Import', reuse: !!existing && reuse && project.snapshots.length > 0, onProgress: setProgress })
      toast({ text: `Analyzed ${fmtInt(result.tickets.length)} tickets`, kind: 'ok' })
      navigate(`/app/p/${p.id}`, true)
    } catch (e) {
      toast({ text: `Analysis failed: ${(e as Error).message}`, kind: 'error' })
      setStep('review')
    }
  }

  const steps: [Step, string][] = [['file', '1 · Choose file'], ['map', '2 · Map columns'], ['review', '3 · Validate & redact'], ['run', '4 · Analyze']]
  const idx = steps.findIndex(s => s[0] === step)

  return (
    <main className="narrow app-main">
      <div className="crumbs"><Link to="/app">Projects</Link>{existing && <><span>/</span><Link to={`/app/p/${existing.id}`}>{existing.name}</Link></>}<span>/</span><span>Import</span></div>
      <div className="page-head"><h1>{existing ? 'Import a new snapshot' : 'New project'}</h1></div>
      <div className="stepper">{steps.map(([k, l], i) => <span key={k} className={i === idx ? 'on' : i < idx ? 'done' : ''}>{l}</span>)}</div>

      {step === 'file' && (
        <div className="col" style={{ gap: 20 }}>
          {!existing && <label className="field">Project name<input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Support queue, EMEA" /></label>}
          <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files[0]) }} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && input.current?.click()}>
            <div style={{ display: 'grid', placeItems: 'center', color: 'var(--moss)' }}><Icon name="upload" size={28} /></div>
            <h3 style={{ marginTop: 14 }}>Drop a ticket export here</h3>
            <p className="small muted" style={{ marginTop: 8 }}>Zendesk JSON or CSV · Intercom CSV or API JSON · Freshdesk CSV · any CSV with a text column</p>
            <p className="xs faint" style={{ marginTop: 14 }}><Icon name="lock" size={12} /> Read locally. Nothing is uploaded.</p>
            <input ref={input} type="file" accept=".csv,.json,.ndjson,.txt,text/csv,application/json" hidden onChange={e => void onFile(e.target.files?.[0])} />
          </div>
          {err && <p role="alert" style={{ color: 'var(--danger)' }} className="small">{err}</p>}
          <div className="card tight">
            <div className="spread wrap-ok" style={{ flexWrap: 'wrap' }}>
              <div><h4>No export handy?</h4><p className="small muted">Load a synthetic file to walk through mapping and redaction.</p></div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => load(sampleNdjson(0), 'northwind-zendesk-sep-2026.json')}>Zendesk JSON sample</button>
                <button className="btn sm" onClick={() => load(sampleFreshdeskCsv(1), 'northwind-freshdesk-oct-2026.csv')}>Freshdesk CSV sample</button>
              </div>
            </div>
          </div>
          <p className="small muted">How to get the file out of your helpdesk: <Link to="/docs">export guides</Link>.</p>
        </div>
      )}

      {step === 'map' && csv && (
        <MapStep csv={csv} onChange={setCsv} onBack={() => setStep('file')} onNext={() => { const r = normalize(text, csv); if (!r.tickets.length) { setErr('No rows had text after mapping. Map a subject or message column.'); return } setErr(''); setStep('review') }} err={err} />
      )}

      {step === 'review' && result && (
        <div className="col" style={{ gap: 20 }}>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="kpi"><span className="xs faint">Tickets imported</span><b>{fmtInt(result.report.imported)}</b><span className="range">of {fmtInt(result.report.total)} rows · {FORMAT_LABELS[result.report.format]}</span></div>
            <div className="kpi"><span className="xs faint">PII redacted</span><b>{fmtInt(Object.values(result.report.pii).reduce((a, b) => a + (b ?? 0), 0))}</b><span className="range">{Object.entries(result.report.pii).map(([k, v]) => `${v} ${PII_LABEL[k as PiiKind].toLowerCase()}`).join(' · ') || 'none found'}</span></div>
            <div className="kpi"><span className="xs faint">Issues</span><b style={{ color: result.report.issues.length ? 'var(--tier-action)' : undefined }}>{fmtInt(result.report.issues.length)}</b><span className="range">{result.report.issues.length ? 'rows skipped or fixed, see below' : 'clean file'}</span></div>
          </div>

          <div className="card">
            <div className="spread"><h4>Redaction preview</h4><span className="xs faint">Redaction runs before cleaning, embedding or storage</span></div>
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 12, gap: 18 }}>
              <label className="check"><input type="checkbox" checked={settings.redactAddresses} onChange={e => { setSettings({ redactAddresses: e.target.checked }); normalize(text) }} />Redact street addresses and postal codes</label>
              <label className="check"><input type="checkbox" checked={settings.redactNames} onChange={e => { setSettings({ redactNames: e.target.checked }); normalize(text) }} />Redact self-introduced names</label>
            </div>
            <p className="xs faint" style={{ marginTop: 6 }}>Emails, phone numbers, Luhn-valid card numbers and IP addresses are always redacted.</p>
            {result.report.samples.length ? result.report.samples.slice(0, 3).map((s, i) => (
              <div className="redact-pair" key={i} style={{ marginTop: 14 }}>
                <div><div className="xs faint" style={{ marginBottom: 6 }}>Original</div><div className="well"><Hl text={s.before} spans={s.spans} /></div></div>
                <div><div className="xs faint" style={{ marginBottom: 6 }}>Stored and analyzed</div><div className="well"><Tok text={s.cleaned} /></div></div>
              </div>
            )) : <p className="small muted" style={{ marginTop: 12 }}>No PII patterns found in this file.</p>}
          </div>

          <div className="grid2">
            <div className="card">
              <h4>Validation report</h4>
              {result.report.issues.length ? (
                <div className="issue-list" style={{ marginTop: 10 }}><ul>{result.report.issues.slice(0, 300).map((x, i) => <li key={i}><span className="mono xs faint">line {x.line}</span> · {x.message}</li>)}</ul>{result.report.issues.length > 300 && <p className="xs faint">…and {result.report.issues.length - 300} more</p>}</div>
              ) : <p className="small muted" style={{ marginTop: 10 }}>Every row parsed. No duplicates, no empty tickets.</p>}
            </div>
            <div className="card">
              <h4>Signals found</h4>
              <ul className="small" style={{ paddingLeft: 0, listStyle: 'none', marginTop: 10, display: 'grid', gap: 6 }}>
                {FIELDS.map(f => { const n = result.report.coverage[f] ?? 0; return <li key={f} className="spread"><span className={n ? '' : 'faint'}>{FIELD_LABELS[f]}</span><span className="mono xs faint">{n ? `${Math.round((n / result.report.imported) * 100)}%` : 'missing'}</span></li> })}
              </ul>
              <p className="xs faint" style={{ marginTop: 10 }}>Missing signals are left out of the score rather than guessed.</p>
            </div>
          </div>

          <div className="card col">
            <label className="field">Snapshot label<input className="input" value={label} onChange={e => setLabel(e.target.value)} /></label>
            {existing && existing.snapshots.length > 0 && (
              <label className="check"><input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} /><span>Keep my intent catalogue<br /><span className="xs muted">Assign tickets to your existing intents (names, overrides and all) so the compare view is apples to apples. New themes become new intents.</span></span></label>
            )}
          </div>
          {result.report.imported < 60 && <p className="small" style={{ color: 'var(--tier-action)' }}>Only {result.report.imported} tickets. Clustering needs a few hundred to be reliable; results will be rough.</p>}
          <div className="spread">
            <button className="btn" onClick={() => setStep(csv ? 'map' : 'file')}>Back</button>
            <button className="btn primary" onClick={run} disabled={result.report.imported < 10}>Analyze {fmtInt(result.report.imported)} tickets <Icon name="arrow" size={16} /></button>
          </div>
        </div>
      )}

      {step === 'run' && <ProgressPanel title={`Analyzing ${fmtInt(result?.tickets.length ?? 0)} tickets`} progress={progress} />}
    </main>
  )
}

function MapStep({ csv, onChange, onBack, onNext, err }: { csv: { table: CsvTable; format: FormatId; mapping: Mapping }; onChange: (c: typeof csv) => void; onBack: () => void; onNext: () => void; err: string }) {
  const { table, format, mapping } = csv
  const preview = (col?: string) => { const i = col ? table.header.indexOf(col) : -1; return i < 0 ? '' : (table.rows.find(r => r[i]?.trim())?.[i] ?? '').slice(0, 70) }
  const ok = !!(mapping.subject || mapping.body)
  const missingText = useMemo(() => !mapping.body, [mapping.body])
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="card tight spread" style={{ flexWrap: 'wrap' }}>
        <div className="row"><span className="chip"><span className="dot ok" />Detected</span><strong style={{ fontWeight: 500 }}>{FORMAT_LABELS[format]}</strong></div>
        <span className="small muted">{fmtInt(table.rows.length)} rows · {table.header.length} columns · delimiter <span className="mono">{table.delimiter === '\t' ? 'tab' : table.delimiter}</span></span>
      </div>
      {format === 'zendesk-csv' && missingText && <p className="small" style={{ color: 'var(--tier-action)' }}>Zendesk’s CSV export has no ticket descriptions, so intents will come from subjects only. The JSON export includes descriptions and agent replies, and gives much better results.</p>}
      {format === 'intercom-csv' && missingText && <p className="small" style={{ color: 'var(--tier-action)' }}>Intercom’s dataset export has no message text. Map a title or topic column, or use the conversations API JSON (see Docs).</p>}
      <div className="card">
        <div className="map-grid">
          {FIELDS.map(f => (
            <label className="field" key={f}>
              <span className="spread"><span>{FIELD_LABELS[f]}{(f === 'subject' || f === 'body') && <span className="faint"> · subject or body required</span>}</span></span>
              <select className="input" value={mapping[f] ?? ''} onChange={e => onChange({ ...csv, mapping: { ...mapping, [f]: e.target.value || undefined } })}>
                <option value="">Not in this file</option>
                {table.header.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="xs faint mono" style={{ minHeight: 16, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{preview(mapping[f])}</span>
            </label>
          ))}
        </div>
      </div>
      {err && <p role="alert" className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
      <div className="spread"><button className="btn" onClick={onBack}>Back</button><button className="btn primary" disabled={!ok} onClick={onNext}>Validate and redact <Icon name="arrow" size={16} /></button></div>
    </div>
  )
}

function Hl({ text, spans }: { text: string; spans: { start: number; end: number }[] }) {
  const out: React.ReactNode[] = []
  let at = 0
  spans.forEach((s, i) => { out.push(text.slice(at, s.start)); out.push(<span key={i} className="pii">{text.slice(s.start, s.end)}</span>); at = s.end })
  out.push(text.slice(at))
  return <>{out}</>
}
function Tok({ text }: { text: string }) {
  return <>{text.split(/(\[[A-Z]+\])/).map((p, i) => (/^\[[A-Z]+\]$/.test(p) ? <span key={i} className="tok">{p}</span> : p))}</>
}
