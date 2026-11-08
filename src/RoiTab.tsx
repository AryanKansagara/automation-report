import { useMemo } from 'react'
import type { Project } from './lib/db.ts'
import { saveProject } from './lib/store.ts'
import { updateSnapshot } from './lib/actions.ts'
import { effectiveTier, type Snapshot } from './engine/analyze.ts'
import { projectAll, intentValue, intentRate, monthlyVolume, SCENARIOS, DEFAULT_ROI, type RoiInputs, type ScenarioId } from './engine/roi.ts'
import { TIER_LABEL, type Tier } from './engine/score.ts'
import { RoiChart } from './charts.tsx'
import { Kpis } from './ProjectView.tsx'
import { fmtInt, fmtMoney, fmtPct, TierBadge } from './ui.tsx'

function Num({ label, value, onChange, step = 1, money, suffix, min = 0, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; money?: boolean; suffix?: string; min?: number; hint?: string }) {
  const input = <input className={`input num ${money ? 'money' : ''}`} type="number" min={min} step={step} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Math.max(min, +e.target.value || 0))} />
  return (
    <label className="field">
      <span>{label}{suffix && <span className="faint"> · {suffix}</span>}</span>
      {money ? <div className="money-wrap">{input}</div> : input}
      {hint && <span className="xs faint">{hint}</span>}
    </label>
  )
}

export default function RoiTab({ p, s }: { p: Project; s: Snapshot }) {
  const r = p.roi
  const set = (patch: Partial<RoiInputs>) => saveProject({ ...p, roi: { ...r, ...patch } })
  const setRate = (t: Tier, v: number) => set({ tierRates: { ...r.tierRates, [t]: v } })
  const pr = useMemo(() => projectAll(s, r), [s, r])
  const scen: ScenarioId[] = ['conservative', 'base', 'optimistic']
  return (
    <div className="col" style={{ gap: 20 }}>
      <Kpis p={p} s={s} />
      <div className="two">
        <div className="card">
          <div className="spread"><h4>Cumulative net savings</h4><span className="xs faint">band = conservative to optimistic</span></div>
          <div style={{ marginTop: 12 }}><RoiChart c={pr.conservative} b={pr.base} o={pr.optimistic} setup={r.setupCost} /></div>
          <div className="scroll-x" style={{ marginTop: 16 }}>
            <table className="table"><thead><tr><th>Scenario</th><th className="r">Resolved/mo</th><th className="r">Hours/mo</th><th className="r">Net/mo</th><th className="r">{r.horizonMonths}-mo net</th><th className="r">Payback</th></tr></thead>
              <tbody>{scen.map(k => { const x = pr[k]; return <tr key={k}><td>{SCENARIOS[k].label}<div className="xs faint">rates ×{SCENARIOS[k].mult}, gap ×{SCENARIOS[k].kbGap}</div></td><td className="r num">{fmtInt(x.fullRamp.resolved)}</td><td className="r num">{fmtInt(x.fullRamp.hours)}</td><td className="r num">{fmtMoney(x.fullRamp.net)}</td><td className="r num">{fmtMoney(x.totalNet - r.setupCost)}</td><td className="r num">{x.paybackMonth == null ? `>${r.horizonMonths} mo` : `${x.paybackMonth.toFixed(1)} mo`}</td></tr> })}</tbody>
            </table>
          </div>
        </div>
        <div className="card col" style={{ gap: 16 }}>
          <div className="spread"><h4>Your assumptions</h4><button className="linkish xs" onClick={() => set(structuredClone(DEFAULT_ROI))}>Reset</button></div>
          <div className="grid2" style={{ gap: 14 }}>
            <Num label="Cost per human-handled ticket" money step={0.5} value={r.costPerTicket} onChange={v => set({ costPerTicket: v })} hint="Fully loaded: salary, tools, overhead" />
            <Num label="Agent minutes per ticket" step={1} value={r.minutesPerTicket} onChange={v => set({ minutesPerTicket: v })} hint="Hands-on time, not elapsed" />
            <Num label="AI price per resolution" money step={0.05} value={r.pricePerResolution} onChange={v => set({ pricePerResolution: v })} hint="From your quote. No vendor price assumed" />
            <Num label="Platform fee per month" money step={100} value={r.monthlyPlatformFee} onChange={v => set({ monthlyPlatformFee: v })} />
            <Num label="One-time setup cost" money step={1000} value={r.setupCost} onChange={v => set({ setupCost: v })} hint="Integration, content, project time" />
            <Num label="Months to full ramp" step={1} value={r.rampMonths} onChange={v => set({ rampMonths: v })} hint="S-curve ramp to full effect" />
            <Num label="Horizon" suffix="months" step={1} min={1} value={r.horizonMonths} onChange={v => set({ horizonMonths: Math.min(60, Math.max(1, v)) })} />
            <Num label="This export covers" suffix="months" step={0.25} min={0.25} value={s.months} onChange={v => updateSnapshot(p, { ...s, months: Math.max(0.25, v) })} hint="Detected from ticket dates" />
          </div>
          <div>
            <div className="small" style={{ marginBottom: 8 }}>Expected AI resolution rate at full ramp</div>
            {(['automatable', 'action', 'human'] as Tier[]).map(t => (
              <div key={t} className="row" style={{ marginBottom: 6 }}>
                <span className="small" style={{ width: 140, flex: 'none', color: `var(--tier-${t === 'automatable' ? 'auto' : t})` }}>{TIER_LABEL[t]}</span>
                <input type="range" min={0} max={0.95} step={0.05} value={r.tierRates[t]} onChange={e => setRate(t, +e.target.value)} aria-label={`${TIER_LABEL[t]} resolution rate`} />
                <span className="num small" style={{ width: 44, textAlign: 'right' }}>{fmtPct(r.tierRates[t])}</span>
              </div>
            ))}
            <p className="xs faint" style={{ marginTop: 8 }}>Each intent’s rate = tier rate × (0.6 + 0.8 × score/100) × scenario multiplier, reduced when no help article covers it, capped at 95%. “Resolved” here means answered without escalating to a person.</p>
          </div>
        </div>
      </div>
      <div className="card scroll-x">
        <h4>By intent (base, full ramp)</h4>
        <table className="table" style={{ marginTop: 10 }}><thead><tr><th>Intent</th><th>Verdict</th><th className="r">Tickets/mo</th><th className="r">Rate</th><th className="r">Resolved/mo</th><th className="r">Hours/mo</th><th className="r">Net/mo</th></tr></thead>
          <tbody>{[...s.intents].map(i => ({ i, v: intentValue(i, s, r) })).sort((a, b) => b.v.net - a.v.net).map(({ i, v }) => (
            <tr key={i.id}><td>{i.name}</td><td><TierBadge tier={effectiveTier(i)} /></td><td className="r num">{fmtInt(monthlyVolume(i, s))}</td><td className="r num">{fmtPct(intentRate(i, r, 'base'))}</td><td className="r num">{fmtInt(v.resolved)}</td><td className="r num">{fmtInt(v.hours)}</td><td className="r num">{fmtMoney(v.net)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
