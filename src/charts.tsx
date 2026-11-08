// Hand-rolled SVG charts. Colours come from CSS variables so both themes work.

import { useState } from 'react'
import type { Projection } from './engine/roi.ts'
import type { Tier } from './engine/score.ts'
import { fmtMoney, fmtPct, fmtInt, tierColor } from './ui.tsx'

function ticks(lo: number, hi: number, n = 4) {
  const span = hi - lo || 1
  const step = Math.pow(10, Math.floor(Math.log10(span / n)))
  const err = (span / n) / step
  const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1)
  const out: number[] = []
  for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(v)
  return out
}

/** Cumulative net savings with the conservative-optimistic band and payback marker. */
export function RoiChart({ c, b, o, setup }: { c: Projection; b: Projection; o: Projection; setup: number }) {
  const W = 960, H = 320, L = 60, R = 16, T = 16, B = 30
  const n = b.monthly.length
  const pts = (p: Projection) => [{ m: 0, v: -setup }, ...p.monthly.map(x => ({ m: x.m, v: x.cumulative }))]
  const all = [...pts(c), ...pts(o)].map(x => x.v)
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all)
  const x = (m: number) => L + (m / n) * (W - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B)
  const line = (p: Projection) => pts(p).map((d, i) => `${i ? 'L' : 'M'}${x(d.m).toFixed(1)},${y(d.v).toFixed(1)}`).join('')
  const band = `${pts(o).map((d, i) => `${i ? 'L' : 'M'}${x(d.m)},${y(d.v)}`).join('')}${pts(c).reverse().map(d => `L${x(d.m)},${y(d.v)}`).join('')}Z`
  const [hover, setHover] = useState<number | null>(null)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Cumulative net savings over ${n} months. Base case ${fmtMoney(b.monthly[n - 1].cumulative)}.`}
      onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const m = Math.round(((e.clientX - r.left) / r.width * W - L) / (W - L - R) * n); setHover(m >= 1 && m <= n ? m : null) }} onMouseLeave={() => setHover(null)}>
      <g className="grid">{ticks(lo, hi).map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{fmtMoney(t)}</text></g>)}</g>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="1.5" />
      {Array.from({ length: n }, (_, i) => i + 1).filter(m => m % (n > 12 ? 3 : 2) === 0 || m === 1).map(m => <text key={m} x={x(m)} y={H - 10} textAnchor="middle">M{m}</text>)}
      <path d={band} fill="var(--tier-auto)" opacity="0.13" />
      <path d={line(c)} fill="none" stroke="var(--tier-auto)" strokeWidth="1" strokeDasharray="3 4" opacity=".7" />
      <path d={line(o)} fill="none" stroke="var(--tier-auto)" strokeWidth="1" strokeDasharray="3 4" opacity=".7" />
      <path d={line(b)} fill="none" stroke="var(--tier-auto)" strokeWidth="2.5" strokeLinecap="round" />
      {b.paybackMonth != null && b.paybackMonth > 0 && b.paybackMonth <= n && (
        <g><line x1={x(b.paybackMonth)} x2={x(b.paybackMonth)} y1={T} y2={H - B} stroke="var(--copper)" strokeDasharray="2 3" /><text x={x(b.paybackMonth) + 6} y={T + 10} style={{ fill: 'var(--copper-ink)' }}>Payback · month {b.paybackMonth.toFixed(1)}</text></g>
      )}
      {hover != null && (() => {
        const d = b.monthly[hover - 1]
        const bx = Math.min(x(hover) + 8, W - 170)
        return <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--ink-3)" /><circle cx={x(hover)} cy={y(d.cumulative)} r="4" fill="var(--tier-auto)" />
          <rect x={bx} y={y(d.cumulative) - 46} width="160" height="40" rx="8" fill="var(--surface-3)" stroke="var(--line)" />
          <text x={bx + 10} y={y(d.cumulative) - 30} style={{ fill: 'var(--ink-1)' }}>Month {hover}: {fmtMoney(d.cumulative)}</text>
          <text x={bx + 10} y={y(d.cumulative) - 15}>{fmtInt(d.resolved)} resolved · {fmtInt(d.hours)} h</text></g>
      })()}
    </svg>
  )
}

/** Opportunity matrix: automatability (x) vs monthly volume (y), bubble = monthly value. */
export function OpportunityMatrix({ items, onSelect }: { items: { id: string; name: string; score: number; volume: number; value: number; tier: Tier }[]; onSelect?: (id: string) => void }) {
  const W = 1100, H = 380, L = 44, R = 16, T = 14, B = 34
  const maxV = Math.max(1, ...items.map(i => i.volume)) * 1.1
  const maxVal = Math.max(1, ...items.map(i => Math.abs(i.value)))
  const x = (s: number) => L + (s / 100) * (W - L - R)
  const y = (v: number) => T + (1 - Math.sqrt(v / maxV)) * (H - T - B)
  const [hover, setHover] = useState<string | null>(null)
  const h = items.find(i => i.id === hover)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Opportunity matrix: intents by automatability and volume">
      <rect x={x(60)} y={T} width={x(100) - x(60)} height={y(maxV * 0.15) - T} fill="var(--tier-auto)" opacity=".06" rx="8" />
      <text x={x(98)} y={T + 14} textAnchor="end" style={{ fill: 'var(--tier-auto)' }}>Automate first</text>
      <g className="grid">{[0, 20, 40, 60, 80, 100].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - B} /><text x={x(t)} y={H - 14} textAnchor="middle">{t}</text></g>)}</g>
      <text x={(L + W - R) / 2} y={H - 1} textAnchor="middle">Automatability score →</text>
      <text x={12} y={(T + H - B) / 2} transform={`rotate(-90 12 ${(T + H - B) / 2})`} textAnchor="middle">Tickets / month →</text>
      {[...items].sort((a, b) => b.volume - a.volume).map(i => (
        <circle key={i.id} cx={x(i.score)} cy={y(i.volume)} r={5 + 18 * Math.sqrt(Math.max(0, i.value) / maxVal)} fill={tierColor(i.tier)} fillOpacity={hover === i.id ? 0.9 : 0.55} stroke={tierColor(i.tier)} strokeWidth="1.2"
          style={{ cursor: onSelect ? 'pointer' : 'default', transition: 'fill-opacity .2s' }} onMouseEnter={() => setHover(i.id)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(i.id)}>
          <title>{i.name}</title>
        </circle>
      ))}
      {h && (() => { const bx = Math.min(x(h.score) + 14, W - 220), by = Math.max(T, y(h.volume) - 50); return <g pointerEvents="none"><rect x={bx} y={by} width="210" height="44" rx="8" fill="var(--surface-3)" stroke="var(--line)" /><text x={bx + 10} y={by + 17} style={{ fill: 'var(--ink-1)' }}>{h.name.slice(0, 30)}</text><text x={bx + 10} y={by + 33}>{fmtInt(h.volume)}/mo · score {h.score} · {fmtMoney(h.value)}/mo</text></g> })()}
    </svg>
  )
}

/** Diverging bars for share change between two snapshots. */
export function DeltaBars({ rows }: { rows: { name: string; shareA: number; shareB: number; delta: number; status: string }[] }) {
  const top = rows.slice(0, 14)
  const W = 640, rowH = 30, L = 210, R = 70, H = top.length * rowH + 20
  const max = Math.max(0.01, ...top.map(r => Math.abs(r.delta)))
  const mid = L + (W - L - R) / 2
  const sc = (W - L - R) / 2 / max
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Change in share of tickets per intent">
      <line x1={mid} x2={mid} y1={0} y2={H - 10} stroke="var(--line)" />
      {top.map((r, i) => {
        const yy = 10 + i * rowH
        const w = Math.abs(r.delta) * sc
        const neg = r.delta < 0
        return <g key={r.name + i}>
          <text x={0} y={yy + 14} dominantBaseline="middle" style={{ fill: 'var(--ink-2)', fontSize: 12 }}>{r.name.length > 30 ? r.name.slice(0, 29) + '…' : r.name}</text>
          <rect x={neg ? mid - w : mid} y={yy + 5} width={Math.max(1.5, w)} height={18} rx="4" fill={neg ? 'var(--tier-auto)' : 'var(--tier-human)'} opacity=".8" />
          <text x={W - 4} y={yy + 14} textAnchor="end" dominantBaseline="middle" style={{ fill: neg ? 'var(--tier-auto)' : 'var(--tier-human)', fontVariantNumeric: 'tabular-nums' }}>{r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}{(Math.abs(r.delta) * 100).toFixed(1)} pts</text>
        </g>
      })}
    </svg>
  )
}

export function TierMeter({ parts }: { parts: { tier: Tier; share: number }[] }) {
  return (
    <div>
      <div className="meter" style={{ height: 12 }}>{parts.map(p => <i key={p.tier} style={{ width: fmtPct(p.share, 1), background: tierColor(p.tier) }} title={`${p.tier} ${fmtPct(p.share)}`} />)}</div>
    </div>
  )
}
