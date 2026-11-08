// The artifacts a support leader acts on: roadmap, intent catalogue, snapshot comparison.

import { effectiveTier, unpackCentroid, type Intent, type Snapshot } from './analyze.ts'
import { ACTIONS, TIER_LABEL, fmtMinutes } from './score.ts'
import { intentValue, type RoiInputs } from './roi.ts'
import type { Ticket } from './formats.ts'
import { toCsv } from './csv.ts'
import { dot } from './util.ts'
import { lexicalEmbed, ticketText } from './lexical.ts'

const actionById = new Map(ACTIONS.map(a => [a.id, a]))

export type Wave = 'now' | 'next' | 'later' | 'human'
export const WAVE_LABEL: Record<Wave, string> = { now: 'Now · weeks 1–4', next: 'Next · months 2–3', later: 'Later · quarter 2', human: 'Keep with people' }

export interface RoadmapItem { intent: Intent; wave: Wave; value: number; resolved: number; hours: number; steps: string[]; blockers: string[] }

export function roadmap(s: Snapshot, r: RoiInputs): RoadmapItem[] {
  const items = s.intents.map(it => {
    const v = intentValue(it, s, r)
    const tier = effectiveTier(it)
    const gap = it.kb?.status === 'gap', partial = it.kb?.status === 'partial'
    const writes = it.actions.map(a => actionById.get(a)!).filter(a => a?.write)
    const reads = it.actions.map(a => actionById.get(a)!).filter(a => a && !a.write)
    const steps: string[] = [], blockers: string[] = []
    if (tier === 'human') {
      steps.push('Keep routed to people; let the AI agent collect order details and hand off with context')
      if (it.signals.negativeRate > 0.25) steps.push('Detect frustration early and skip straight to a person')
    } else {
      if (gap) { blockers.push('No help article covers this'); steps.push(`Write an article answering “${it.name}”`) }
      else if (partial) steps.push(`Tighten “${it.kb!.title}” so it answers this intent directly`)
      for (const a of reads) steps.push(`Connect ${a.label.toLowerCase()} (${a.api})`)
      if (tier === 'action') for (const a of writes) { steps.push(`Connect ${a.label.toLowerCase()} (${a.api})`); blockers.push(`Needs ${a.api}`) }
      steps.push(`Launch for ${it.name}, then review 50 transcripts`)
    }
    let wave: Wave = 'human'
    if (tier !== 'human') wave = tier === 'automatable' && !gap && reads.length === 0 ? 'now' : tier === 'automatable' || v.net >= 0 ? 'next' : 'later'
    return { intent: it, wave, value: v.net, resolved: v.resolved, hours: v.hours, steps, blockers }
  })
  // Within "next", the most valuable half moves up; action-API work with low value moves to later.
  const nextItems = items.filter(i => i.wave === 'next' && effectiveTier(i.intent) === 'action').sort((a, b) => b.value - a.value)
  nextItems.slice(Math.ceil(nextItems.length / 2)).forEach(i => (i.wave = 'later'))
  const order: Record<Wave, number> = { now: 0, next: 1, later: 2, human: 3 }
  return items.sort((a, b) => order[a.wave] - order[b.wave] || b.value - a.value)
}

/** Suggested answer outline: the most typical agent reply, as steps; otherwise a template. */
export function answerOutline(it: Intent, members: Ticket[]): string[] {
  const replies = members.flatMap(t => t.agentReplies.slice(0, 1)).filter(r => r.length > 30)
  const tier = effectiveTier(it)
  if (replies.length >= 3) {
    const V = replies.slice(0, 80).map(lexicalEmbed)
    const c = new Float32Array(V[0].length)
    V.forEach(v => v.forEach((x, i) => (c[i] += x)))
    let best = 0, bs = -Infinity
    V.forEach((v, i) => { const s = dot(v, c); if (s > bs) { bs = s; best = i } })
    const sentences = replies[best].replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 12 && !/^(hi|hello|hey|thanks|thank you|best|cheers|regards)\b/i.test(s))
    if (sentences.length) return sentences.slice(0, 5)
  }
  const out = [`Acknowledge the request about ${it.keywords.slice(0, 2).join(' / ') || it.name.toLowerCase()}`]
  if (it.kb && it.kb.status !== 'gap') out.push(`Answer from the article “${it.kb.title}”`)
  for (const a of it.actions) { const x = actionById.get(a); if (x) out.push(`${x.write ? 'Perform' : 'Look up'}: ${x.label.toLowerCase()}`) }
  out.push(tier === 'human' ? 'Collect details, then hand off to a person with a summary' : 'Confirm it solved the problem; offer a person if not')
  return out
}

export interface CatalogueEntry {
  intent: string; description: string; tier: string; score: number; tickets: number; share: string
  keywords: string[]; example_phrasings: string[]; suggested_answer_outline: string[]
  required_actions: string[]; help_article: string; median_resolution: string
}

export function catalogue(s: Snapshot, tickets: Ticket[] | null, assign: ArrayLike<number> | null): CatalogueEntry[] {
  return s.intents.map((it, c) => {
    const members = tickets && assign ? tickets.filter((_, i) => assign[i] === c) : []
    return {
      intent: it.name,
      description: it.description,
      tier: TIER_LABEL[effectiveTier(it)],
      score: it.score,
      tickets: it.size,
      share: `${(it.share * 100).toFixed(1)}%`,
      keywords: it.keywords,
      example_phrasings: tickets ? it.exampleIdx.map(i => tickets[i] && ticketText(tickets[i]).slice(0, 220)).filter(Boolean) : [],
      suggested_answer_outline: answerOutline(it, members),
      required_actions: it.actions.map(a => { const x = actionById.get(a)!; return `${x.label} — ${x.api}` }),
      help_article: it.kb ? `${it.kb.title} (${it.kb.status}, similarity ${it.kb.sim.toFixed(2)})${it.kb.url ? ' ' + it.kb.url : ''}` : '',
      median_resolution: it.signals.medianHandle != null ? fmtMinutes(it.signals.medianHandle) : '',
    }
  })
}

export function catalogueCsv(entries: CatalogueEntry[]): string {
  const keys = Object.keys(entries[0] ?? { intent: '' }) as (keyof CatalogueEntry)[]
  return toCsv(keys, entries.map(e => keys.map(k => (Array.isArray(e[k]) ? (e[k] as string[]).join(' | ') : e[k]))))
}

// ---------- compare ----------

export interface CompareRow { id: string; name: string; tier: string; shareA: number; shareB: number; monthlyA: number; monthlyB: number; delta: number; status: 'both' | 'new' | 'gone' }

/** Matches intents by id (shared catalogue) or, failing that, by centroid similarity. */
export function compareSnapshots(a: Snapshot, b: Snapshot, minSim = 0.8): CompareRow[] {
  const rows: CompareRow[] = []
  const used = new Set<string>()
  const Bc = b.intents.map(i => unpackCentroid(i.centroid))
  for (const ia of a.intents) {
    let ib = a.catalogue === b.catalogue ? b.intents.find(x => x.id === ia.id) : undefined
    if (!ib) {
      const ca = unpackCentroid(ia.centroid)
      let best = -1, bs = minSim
      b.intents.forEach((x, j) => { if (!used.has(x.id)) { const s = dot(ca, Bc[j]); if (s >= bs) { bs = s; best = j } } })
      if (best >= 0) ib = b.intents[best]
    }
    const mA = ia.size / a.months
    if (ib) {
      used.add(ib.id)
      rows.push({ id: ia.id, name: ib.name, tier: TIER_LABEL[effectiveTier(ib)], shareA: ia.share, shareB: ib.share, monthlyA: mA, monthlyB: ib.size / b.months, delta: ib.share - ia.share, status: 'both' })
    } else rows.push({ id: ia.id, name: ia.name, tier: TIER_LABEL[effectiveTier(ia)], shareA: ia.share, shareB: 0, monthlyA: mA, monthlyB: 0, delta: -ia.share, status: 'gone' })
  }
  for (const ib of b.intents) if (!used.has(ib.id)) rows.push({ id: ib.id, name: ib.name, tier: TIER_LABEL[effectiveTier(ib)], shareA: 0, shareB: ib.share, monthlyA: 0, monthlyB: ib.size / b.months, delta: ib.share, status: 'new' })
  return rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
}
