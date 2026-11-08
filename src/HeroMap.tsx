// Landing hero: the real pipeline on 320 synthetic tickets. Each ticket is
// redacted and cleaned by the engine, its MiniLM vector comes from the
// precomputed cache (keyed by the cleaned text), and it is assigned to the
// nearest intent centroid learned from the batch.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ClusterMap, type MapData } from './ClusterMap.tsx'
import { generateSample } from './engine/sample.ts'
import { normalizeJson, type Ticket } from './engine/formats.ts'
import { findPii, type Span } from './engine/redact.ts'
import { stripHtml } from './engine/clean.ts'
import { parseCache } from './engine/embcache.ts'
import { ticketText } from './engine/lexical.ts'
import { textKey, dot } from './engine/util.ts'
import { cluster, layout2d } from './engine/cluster.ts'
import { buildIntents, effectiveTier, type Intent } from './engine/analyze.ts'
import { TIER_LABEL } from './engine/score.ts'
import { Link, Icon, fmtPct, tierColor } from './ui.tsx'

const N = 320

interface Prepared { tickets: Ticket[]; raw: { text: string; spans: Span[]; channel: string; id: number }[]; X: Float32Array[]; intents: Intent[]; map: MapData }

async function prepare(): Promise<Prepared> {
  const buf = await fetch('/emb/hero.bin').then(r => r.arrayBuffer())
  const cache = parseCache(buf)
  const records = generateSample(0).slice(0, N)
  const { tickets } = normalizeJson(records.map(r => JSON.stringify(r)).join('\n'))
  const X = tickets.map(t => cache.get(textKey(ticketText(t)))).filter((x): x is Float32Array => !!x)
  if (X.length !== tickets.length) throw new Error('hero cache mismatch')
  const km = cluster(X, 11, 5)
  const intents = buildIntents(tickets, X, km.assign, 11)
  // buildIntents sorts by size; map cluster index -> intent
  const C = intents.map(i => km.centroids[+i.id.slice(1)])
  const assign = Int32Array.from(X, x => { let b = 0, bs = -1; C.forEach((c, j) => { const s = dot(x, c); if (s > bs) { bs = s; b = j } }); return b })
  const l = layout2d(X, assign, C)
  const raw = records.map(r => { const text = stripHtml(r.description).replace(/\s+\n/g, '\n').trim().slice(0, 240); return { text, spans: findPii(text), channel: r.via.channel, id: r.id } })
  return { tickets, raw, X, intents, map: { x: l.x, y: l.y, assign, centers: l.centers, names: intents.map(i => i.name), tiers: intents.map(effectiveTier) } }
}

function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  const out: React.ReactNode[] = []
  let at = 0
  spans.forEach((s, i) => { out.push(text.slice(at, s.start)); out.push(<span key={i} className="pii">{text.slice(s.start, s.end)}</span>); at = s.end })
  out.push(text.slice(at))
  return <>{out}</>
}

function Tokenized({ text }: { text: string }) {
  return <>{text.split(/(\[[A-Z]+\])/).map((p, i) => (/^\[[A-Z]+\]$/.test(p) ? <span key={i} className="tok">{p}</span> : p))}</>
}

export function HeroMap() {
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [failed, setFailed] = useState(false)
  const born = useMemo(() => new Float64Array(N).fill(Infinity), [])
  const [count, setCount] = useState(0)
  const [feat, setFeat] = useState<{ i: number; phase: number } | null>(null)
  const visible = useRef(true)
  const countRef = useRef(0)
  countRef.current = count
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => prepare().then(setPrep).catch(() => setFailed(true)), 30)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting })
    if (box.current) io.observe(box.current)
    return () => io.disconnect()
  }, [])

  // Stream tickets in.
  useEffect(() => {
    if (!prep) return
    let n = 0, timer: ReturnType<typeof setTimeout>
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { born.fill(0); setCount(N); setFeat({ i: N - 1, phase: 3 }); return }
    const tick = () => {
      if (visible.current && !document.hidden) {
        if (n >= N) { born.fill(Infinity); n = 0; setCount(0) }
        else {
          const burst = n < 60 ? 3 : 1
          for (let b = 0; b < burst && n < N; b++) born[n++] = performance.now()
          setCount(n)
        }
      }
      timer = setTimeout(tick, n >= N ? 7000 : n < 60 ? 90 : 150)
    }
    timer = setTimeout(tick, 400)
    return () => clearTimeout(timer)
  }, [prep, born])

  // Featured ticket walks through redact -> clean -> embed -> assign.
  useEffect(() => {
    if (!prep) return
    let phase = 0, i = 0, timer: ReturnType<typeof setTimeout>
    const step = () => {
      if (phase === 0) {
        // Prefer a recent ticket that actually contains PII.
        const cur = Math.max(0, countRef.current - 1)
        i = cur
        for (let j = cur; j > Math.max(0, cur - 25); j--) if (prep.raw[j].spans.length) { i = j; break }
      }
      setFeat({ i, phase })
      phase = (phase + 1) % 5
      timer = setTimeout(step, [1500, 1100, 900, 2000, 250][phase === 0 ? 4 : phase - 1])
    }
    timer = setTimeout(step, 300)
    return () => clearTimeout(timer)
  }, [prep])

  const stats = useMemo(() => {
    if (!prep) return null
    let pii = 0, auto = 0
    const seen = new Set<number>()
    for (let i = 0; i < count; i++) {
      pii += prep.raw[i].spans.length
      const c = prep.map.assign[i]
      seen.add(c)
      if (prep.map.tiers[c] === 'automatable') auto++
    }
    return { pii, intents: seen.size, auto: count ? auto / count : 0 }
  }, [prep, count])

  const f = feat && prep ? feat : null
  const t = f ? prep!.tickets[f.i] : null
  const c = f ? prep!.map.assign[f.i] : 0
  const it = f ? prep!.intents[c] : null
  const vec = f ? prep!.X[f.i] : null

  return (
    <div className="panel heromap" ref={box} aria-label="Live demo: sample tickets are redacted, embedded and clustered into intents">
      <div className="stream">
        <div className="spread">
          <span className="eyebrow">Live pipeline · in this tab</span>
          <span className="chip"><span className="dot ok" />running</span>
        </div>
        {f && t && prep ? (
          <>
            <div className="ticket-card" key={f.i}>
              <div className="meta"><span>#{prep.raw[f.i].id} · {prep.raw[f.i].channel}</span><span>{f.phase === 0 ? 'raw' : 'redacted'}</span></div>
              {f.phase === 0 ? <Highlighted text={prep.raw[f.i].text} spans={prep.raw[f.i].spans} /> : <Tokenized text={ticketText(t).slice(0, 240)} />}
            </div>
            <div className="steps">
              <div className={`step ${f.phase >= 1 ? 'on' : ''}`}><i>1</i>Redact PII · {prep.raw[f.i].spans.length ? `${prep.raw[f.i].spans.length} found` : 'none found'}</div>
              <div className={`step ${f.phase >= 1 ? 'on' : ''}`}><i>2</i>Strip signature, quotes, boilerplate</div>
              <div className={`step ${f.phase >= 2 ? 'on' : ''}`}><i>3</i>Embed · MiniLM, 384 dims</div>
              <div className={`step ${f.phase >= 3 ? 'on' : ''}`}><i>4</i>Assign to nearest intent</div>
            </div>
            <div className="vecstrip" aria-hidden="true">
              {Array.from({ length: 48 }, (_, d) => <i key={d} style={{ height: f.phase >= 2 && vec ? `${8 + Math.min(92, Math.abs(vec[d * 8]) * 900)}%` : '8%', opacity: f.phase >= 2 ? 0.35 + Math.min(0.65, Math.abs(vec![d * 8]) * 6) : 0.2 }} />)}
            </div>
            <div className="assigned" style={{ borderColor: f.phase >= 3 && it ? tierColor(effectiveTier(it)) : undefined }}>
              {f.phase >= 3 && it ? (
                <div className="spread"><div><div style={{ fontWeight: 500 }}>{it.name}</div><div className="xs muted">{TIER_LABEL[effectiveTier(it)]} · score {it.score}</div></div><span className="mono xs faint">{simTo(prep, f.i)}</span></div>
              ) : <span className="faint xs">Waiting for embedding…</span>}
            </div>
          </>
        ) : (
          <>
            <div className="skeleton" style={{ height: 148 }} />
            <div className="skeleton" style={{ height: 90 }} />
            <div className="skeleton" style={{ height: 64 }} />
            {failed && <p className="xs muted">The demo could not load. The app still works: open it below.</p>}
          </>
        )}
        <div className="hstats">
          <div className="hstat"><span className="xs faint">Tickets</span><b>{count}</b></div>
          <div className="hstat"><span className="xs faint">PII redacted</span><b>{stats?.pii ?? 0}</b></div>
          <div className="hstat"><span className="xs faint">Intents</span><b>{stats?.intents ?? 0}</b></div>
          <div className="hstat"><span className="xs faint">Automatable</span><b>{fmtPct(stats?.auto ?? 0)}</b></div>
        </div>
      </div>
      <div className="stage gridbg">
        <div className="stage-top"><span className="eyebrow">Intent map · synthetic sample</span><span className="xs faint mono hide-sm">all-MiniLM-L6-v2 · k-means</span></div>
        {prep && <ClusterMap data={prep.map} born={born} live labelMin={0.045} pointSize={2.6} selected={f && f.phase >= 3 ? c : null} />}
        <div className="legend">
          <span className="chip"><span className="sw" style={{ background: 'var(--tier-auto)' }} />Automatable</span>
          <span className="chip"><span className="sw" style={{ background: 'var(--tier-action)' }} />Needs action API</span>
          <span className="chip"><span className="sw" style={{ background: 'var(--tier-human)' }} />Human only</span>
          <Link to="/app?sample=1" className="chip" style={{ textDecoration: 'none', color: 'var(--ink-1)' }}>Run it on 2,550 tickets <Icon name="arrow" size={13} /></Link>
        </div>
      </div>
    </div>
  )
}

function simTo(p: Prepared, i: number) {
  const C = p.intents[p.map.assign[i]].centroid
  let s = 0
  for (let d = 0; d < 384; d++) s += p.X[i][d] * C.q[d] * C.s
  return `cos ${s.toFixed(2)}`
}
