// Automatability scoring. Every factor is a 0..1 "friendliness to automation"
// value with a weight and a plain-English detail, so the score explains itself.

import type { Ticket } from './formats.ts'
import { clamp, dot, median, mean } from './util.ts'
import { lexicalEmbed } from './lexical.ts'

export type Tier = 'automatable' | 'action' | 'human'
export const TIER_LABEL: Record<Tier, string> = { automatable: 'Automatable', action: 'Needs action API', human: 'Human only' }

export interface Action { id: string; label: string; api: string; write: boolean; re: RegExp }

export const ACTIONS: Action[] = [
  { id: 'order-lookup', label: 'Order status lookup', api: 'Order management or carrier tracking API (read)', write: false, re: /\b(where is my (order|package|parcel)|track(ing)?( number| info)?|hasn'?t (arrived|shipped)|not (arrived|received)|still waiting|delivery status|out for delivery|when will (it|my order) (arrive|ship))\b/i },
  { id: 'refund', label: 'Issue or check a refund', api: 'Payments / refunds API (write)', write: true, re: /\b(refund(ed)?|money back|reimburse)/i },
  { id: 'cancel-order', label: 'Cancel an order', api: 'Order management API (write)', write: true, re: /\bcancel(l?ed|l?ing)? (my |the |this )?(order|purchase)\b/i },
  { id: 'address-change', label: 'Change shipping address', api: 'Order management API (write)', write: true, re: /\b(change|update|wrong|correct)( the| my)? (shipping |delivery )?address\b/i },
  { id: 'return-label', label: 'Create a return or exchange', api: 'Returns platform API (write)', write: true, re: /\b(return label|send (it|this|them) back|start a return|exchange (it|this|for)|return (my|the|this) )/i },
  { id: 'password', label: 'Reset password / unlock account', api: 'Identity provider API (write)', write: true, re: /\b(reset (my )?password|can'?t log ?in|locked out|login (link|code)|two.factor|2fa|verification code)\b/i },
  { id: 'subscription', label: 'Pause, skip or cancel subscription', api: 'Subscription billing API (write)', write: true, re: /\b(subscription|skip (next|this) (month|box|delivery)|pause my|cancel my (plan|membership|subscription))\b/i },
  { id: 'payment-lookup', label: 'Payment or charge lookup', api: 'Payments API (read)', write: false, re: /\b(charged twice|double charged|declined|payment (failed|didn'?t go through)|pending charge|authori[sz]ation hold)\b/i },
  { id: 'promo', label: 'Validate a promo code', api: 'Commerce promotions API (read)', write: false, re: /\b(promo|discount|coupon) code\b|\bcode (isn'?t|is not|doesn'?t) work/i },
  { id: 'replacement', label: 'Send a replacement', api: 'Order management API (write)', write: true, re: /\b(replacement|replace (it|the item)|send (me )?(a )?new one|reship)\b/i },
  { id: 'privacy', label: 'Account deletion / data request', api: 'CRM or privacy tooling (write)', write: true, re: /\b(delete (my )?account|close my account|gdpr|ccpa|personal data|unsubscribe me)\b/i },
]

const NEG = /\b(unacceptable|ridiculous|furious|angry|worst|terrible|awful|disgusted|scam|fraud|lawyer|legal action|chargeback|dispute|report you|bbb|never (again|order)|disappoint\w*|fed up|third time|still no|no one (has )?(replied|responded)|useless|horrible|outraged)\b/i

export function negativity(text: string): number {
  let s = 0
  if (NEG.test(text)) s += 0.6
  if (/!!+/.test(text)) s += 0.2
  const caps = text.match(/\b[A-Z]{4,}\b/g)?.filter(w => !/^(ASAP|HTTP|HTTPS|EMAIL|PHONE|CARD|ADDRESS|NAME|USPS|UPS|DHL|FEDEX|GDPR|CCPA)$/.test(w)).length ?? 0
  if (caps >= 2) s += 0.3
  return Math.min(1, s)
}

export function detectActions(texts: string[]): { id: string; share: number }[] {
  const hits = new Map<string, number>()
  for (const t of texts) for (const a of ACTIONS) if (a.re.test(t)) hits.set(a.id, (hits.get(a.id) ?? 0) + 1)
  return [...hits].map(([id, c]) => ({ id, share: c / Math.max(1, texts.length) })).sort((a, b) => b.share - a.share)
}

export interface Factor { key: string; label: string; value: number; weight: number; detail: string }
export interface Signals {
  cohesion: number
  cohesionRank: number
  writeShare: number
  readShare: number
  actions: { id: string; share: number }[]
  replyConsistency: number | null
  reopenRate: number | null
  medianHandle: number | null
  handleRatio: number | null
  negativeRate: number
  escalationRate: number
  csat: number | null
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Average pairwise lexical similarity of agent replies: high means agents keep sending the same answer. */
export function replyConsistency(replies: string[]): number | null {
  const r = replies.filter(x => x.length > 20).slice(0, 40)
  if (r.length < 3) return null
  const v = r.map(lexicalEmbed)
  let s = 0, n = 0
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) { s += dot(v[i], v[j]); n++ }
  return n ? s / n : null
}

export function computeSignals(members: Ticket[], cohesion: number, cohesionRank: number, globalHandle: number | null): Signals {
  const texts = members.map(t => `${t.subject} ${t.body}`)
  const actions = detectActions(texts)
  const share = (write: boolean) => {
    // A ticket counts once even if it matches several actions of the same kind.
    let c = 0
    for (const t of texts) if (ACTIONS.some(a => a.write === write && a.re.test(t))) c++
    return c / Math.max(1, texts.length)
  }
  const withReopen = members.filter(t => t.reopens != null)
  const handles = members.map(t => t.handleMinutes).filter((x): x is number => x != null)
  const medianHandle = median(handles)
  const csats = members.map(t => t.csat).filter((x): x is number => x != null)
  return {
    cohesion, cohesionRank,
    writeShare: share(true), readShare: share(false), actions,
    replyConsistency: replyConsistency(members.flatMap(t => t.agentReplies.slice(0, 1))),
    reopenRate: withReopen.length >= 5 ? withReopen.filter(t => (t.reopens ?? 0) > 0).length / withReopen.length : null,
    medianHandle,
    handleRatio: medianHandle != null && globalHandle ? medianHandle / globalHandle : null,
    negativeRate: mean(texts.map(t => (negativity(t) >= 0.5 ? 1 : 0))),
    escalationRate: mean(members.map(t => (t.escalated ? 1 : 0))),
    csat: csats.length >= 5 ? mean(csats) : null,
  }
}

export function scoreSignals(s: Signals): { score: number; tier: Tier; factors: Factor[] } {
  const f: Factor[] = [
    { key: 'repetition', label: 'Repetitive phrasing', weight: 0.2, value: clamp(0.25 + 0.75 * s.cohesionRank), detail: `Tickets read alike (cohesion ${s.cohesion.toFixed(2)}, tighter than ${pct(s.cohesionRank)} of intents)` },
    { key: 'action', label: 'Information vs account action', weight: 0.24, value: clamp(1 - 0.95 * s.writeShare - 0.3 * s.readShare), detail: s.writeShare > 0.05 || s.readShare > 0.05 ? `${pct(s.writeShare)} ask for a change to an account or order, ${pct(s.readShare)} need a lookup` : 'Answerable from information alone' },
    { key: 'sentiment', label: 'Customer sentiment', weight: 0.12, value: clamp(1 - 2.5 * s.negativeRate), detail: `${pct(s.negativeRate)} of messages are angry or threatening` },
    { key: 'escalation', label: 'Escalation history', weight: 0.12, value: clamp(1 - 2.5 * s.escalationRate), detail: `${pct(s.escalationRate)} were escalated or handed off` },
  ]
  if (s.replyConsistency != null) f.push({ key: 'consistency', label: 'Agents give the same answer', weight: 0.14, value: clamp((s.replyConsistency - 0.1) / 0.5), detail: `Agent replies are ${s.replyConsistency > 0.4 ? 'highly' : s.replyConsistency > 0.25 ? 'fairly' : 'not very'} consistent (similarity ${s.replyConsistency.toFixed(2)})` })
  if (s.reopenRate != null) f.push({ key: 'reopen', label: 'Reopen rate', weight: 0.1, value: clamp(1 - 3 * s.reopenRate), detail: `${pct(s.reopenRate)} were reopened after being solved` })
  if (s.handleRatio != null) f.push({ key: 'handle', label: 'Time to resolve', weight: 0.08, value: clamp(0.5 - Math.log2(s.handleRatio) / 3), detail: `Median ${fmtMinutes(s.medianHandle!)}, ${s.handleRatio < 1 ? `${(1 / s.handleRatio).toFixed(1)}× faster` : `${s.handleRatio.toFixed(1)}× slower`} than your overall median` })
  if (s.csat != null) f.push({ key: 'csat', label: 'Satisfaction today', weight: 0.06, value: clamp(s.csat), detail: `Average rating ${pct(s.csat)} of max` })
  const wsum = f.reduce((a, x) => a + x.weight, 0)
  for (const x of f) x.weight /= wsum
  const score = Math.round(100 * f.reduce((a, x) => a + x.weight * x.value, 0))
  let tier: Tier = 'automatable'
  if (score < 42 || s.negativeRate > 0.35 || s.escalationRate > 0.4) tier = 'human'
  else if (s.writeShare >= 0.3) tier = 'action'
  return { score, tier, factors: f }
}

export function fmtMinutes(m: number): string {
  if (m < 90) return `${Math.round(m)} min`
  if (m < 60 * 36) return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`
  return `${(m / 1440).toFixed(1)} days`
}
