// ROI model. Every number is a user input; nothing here asserts vendor pricing.

import { effectiveTier, type Intent, type Snapshot } from './analyze.ts'
import type { Tier } from './score.ts'
import { clamp } from './util.ts'

export interface RoiInputs {
  costPerTicket: number
  minutesPerTicket: number
  pricePerResolution: number
  monthlyPlatformFee: number
  setupCost: number
  rampMonths: number
  horizonMonths: number
  /** Expected share of an intent's tickets the AI agent resolves at full ramp, by tier. */
  tierRates: Record<Tier, number>
}

export const DEFAULT_ROI: RoiInputs = {
  costPerTicket: 6,
  minutesPerTicket: 9,
  pricePerResolution: 1,
  monthlyPlatformFee: 0,
  setupCost: 15000,
  rampMonths: 4,
  horizonMonths: 12,
  tierRates: { automatable: 0.7, action: 0.45, human: 0 },
}

export type ScenarioId = 'conservative' | 'base' | 'optimistic'
export const SCENARIOS: Record<ScenarioId, { label: string; mult: number; kbGap: number }> = {
  conservative: { label: 'Conservative', mult: 0.6, kbGap: 0.5 },
  base: { label: 'Base', mult: 1, kbGap: 0.8 },
  optimistic: { label: 'Optimistic', mult: 1.25, kbGap: 1 },
}

/** Resolution rate for one intent at full ramp: tier rate, nudged by score, discounted when there is no help article. */
export function intentRate(it: Intent, r: RoiInputs, sc: ScenarioId): number {
  const base = r.tierRates[effectiveTier(it)]
  if (!base) return 0
  const s = SCENARIOS[sc]
  const gap = it.kb && it.kb.status === 'gap' ? s.kbGap : it.kb?.status === 'partial' ? (1 + s.kbGap) / 2 : 1
  return clamp(base * (0.6 + 0.8 * (it.score / 100)) * s.mult * gap, 0, 0.95)
}

/** Smoothstep ramp: month m (1-based) reaches full effect at rampMonths. */
export function ramp(m: number, months: number): number {
  if (months <= 0) return 1
  const x = clamp(m / months)
  return x * x * (3 - 2 * x)
}

export interface Projection {
  scenario: ScenarioId
  monthly: { m: number; resolved: number; hours: number; gross: number; aiCost: number; net: number; cumulative: number }[]
  fullRamp: { resolved: number; hours: number; gross: number; aiCost: number; net: number; share: number }
  totalNet: number
  totalHours: number
  paybackMonth: number | null
}

export const monthlyVolume = (it: Intent, s: Snapshot) => it.size / Math.max(0.25, s.months)

export function project(s: Snapshot, r: RoiInputs, sc: ScenarioId): Projection {
  let resolvedFull = 0
  for (const it of s.intents) resolvedFull += monthlyVolume(it, s) * intentRate(it, r, sc)
  const totalMonthly = s.total / Math.max(0.25, s.months)
  const unit = r.costPerTicket - r.pricePerResolution
  const monthly: Projection['monthly'] = []
  let cum = -r.setupCost, payback: number | null = r.setupCost <= 0 ? 0 : null
  for (let m = 1; m <= r.horizonMonths; m++) {
    const resolved = resolvedFull * ramp(m, r.rampMonths)
    const gross = resolved * r.costPerTicket
    const aiCost = resolved * r.pricePerResolution + r.monthlyPlatformFee
    const net = gross - aiCost
    const prev = cum
    cum += net
    if (payback == null && cum >= 0) payback = m - 1 + (net > 0 ? -prev / net : 0)
    monthly.push({ m, resolved, hours: (resolved * r.minutesPerTicket) / 60, gross, aiCost, net, cumulative: cum })
  }
  return {
    scenario: sc,
    monthly,
    fullRamp: { resolved: resolvedFull, hours: (resolvedFull * r.minutesPerTicket) / 60, gross: resolvedFull * r.costPerTicket, aiCost: resolvedFull * r.pricePerResolution + r.monthlyPlatformFee, net: resolvedFull * unit - r.monthlyPlatformFee, share: totalMonthly ? resolvedFull / totalMonthly : 0 },
    totalNet: cum + r.setupCost,
    totalHours: monthly.reduce((a, x) => a + x.hours, 0),
    paybackMonth: payback,
  }
}

export function projectAll(s: Snapshot, r: RoiInputs) {
  return { conservative: project(s, r, 'conservative'), base: project(s, r, 'base'), optimistic: project(s, r, 'optimistic') }
}

/** Monthly net value of one intent at full ramp (base scenario). */
export function intentValue(it: Intent, s: Snapshot, r: RoiInputs, sc: ScenarioId = 'base') {
  const resolved = monthlyVolume(it, s) * intentRate(it, r, sc)
  return { resolved, net: resolved * (r.costPerTicket - r.pricePerResolution), hours: (resolved * r.minutesPerTicket) / 60 }
}
