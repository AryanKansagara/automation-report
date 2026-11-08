// Turns normalized tickets + embeddings into a snapshot: intents with labels,
// signals, scores and examples. Also merge / split / re-use of an intent catalogue.

import type { Ticket } from './formats.ts'
import { chooseK, cluster, cTfidf, nameFromKeywords, nameFromSubjects, byTypicality, diverseExamples, centroidOf, kmeans, type Vec } from './cluster.ts'
import { computeSignals, scoreSignals, type Signals, type Factor, type Tier } from './score.ts'
import { dot, median, quantize, dequantize } from './util.ts'
import type { PiiKind } from './redact.ts'

export type Embedder = 'minilm' | 'lexical'

export interface KbMatch { articleId: string; title: string; url?: string; sim: number; status: 'covered' | 'partial' | 'gap' }

export interface Intent {
  id: string
  name: string
  autoName: string
  description: string
  keywords: string[]
  size: number
  share: number
  signals: Signals
  score: number
  tier: Tier
  override?: Tier
  factors: Factor[]
  actions: string[]
  kb?: KbMatch
  centroid: { s: number; q: number[] }
  exampleIdx: number[]
}

export interface Snapshot {
  id: string
  label: string
  createdAt: number
  embedder: Embedder
  source: { format: string; fileName: string; total: number; imported: number; pii: Partial<Record<PiiKind, number>> }
  periodStart: number | null
  periodEnd: number | null
  months: number
  total: number
  k: number
  kScores: { k: number; s: number }[]
  intents: Intent[]
  reusedFrom?: string
  /** Snapshots sharing a catalogue id share intent ids. */
  catalogue: string
}

export const effectiveTier = (i: Intent): Tier => i.override ?? i.tier

export function packCentroid(v: Vec) { const { scale, q } = quantize(v); return { s: scale, q: Array.from(q) } }
export function unpackCentroid(c: { s: number; q: number[] }): Vec { return dequantize(Int8Array.from(c.q), c.s) }

function members(assign: ArrayLike<number>, c: number): number[] {
  const out: number[] = []
  for (let i = 0; i < assign.length; i++) if (assign[i] === c) out.push(i)
  return out
}

/**
 * Builds intents for clusters 0..k-1 of `assign`. `ids` lets callers keep stable
 * ids (and names/overrides via `keep`) when re-scoring after a merge or split.
 */
export function buildIntents(tickets: Ticket[], X: Vec[], assign: ArrayLike<number>, k: number, keep: (Partial<Intent> | undefined)[] = []): Intent[] {
  // Subjects count double: they are the customer's own one-line summary.
  const docs = tickets.map(t => `${t.subject}. ${t.subject}. ${t.body.slice(0, 400)}`)
  const labels = cTfidf(docs, assign, k)
  const globalHandle = median(tickets.map(t => t.handleMinutes ?? NaN))
  const groups = Array.from({ length: k }, (_, c) => members(assign, c))
  const centroids = groups.map(g => centroidOf(X, g))
  const cohesion = groups.map((g, c) => (g.length ? g.reduce((a, i) => a + dot(X[i], centroids[c]), 0) / g.length : 0))
  const sorted = [...cohesion].sort((a, b) => a - b)
  const rank = (x: number) => (k > 1 ? sorted.indexOf(x) / (k - 1) : 0.5)
  const intents: Intent[] = []
  groups.forEach((g, c) => {
    if (!g.length) return
    const prev = keep[c]
    const mt = g.map(i => tickets[i])
    const signals = computeSignals(mt, cohesion[c], rank(cohesion[c]), globalHandle)
    const { score, tier, factors } = scoreSignals(signals)
    const ranked = byTypicality(X, g, centroids[c])
    const autoName = nameFromSubjects(mt.map(t => t.subject)) ?? nameFromKeywords(labels[c])
    intents.push({
      id: prev?.id ?? `i${c}`,
      name: prev?.name || autoName,
      autoName,
      description: prev?.description || describe(labels[c]),
      keywords: labels[c],
      size: g.length,
      share: g.length / tickets.length,
      signals, score, tier, factors,
      override: prev?.override,
      actions: signals.actions.filter(a => a.share >= 0.15).map(a => a.id),
      kb: prev?.kb,
      centroid: packCentroid(centroids[c]),
      exampleIdx: diverseExamples(X, ranked, 6),
    })
  })
  return intents.sort((a, b) => b.size - a.size)
}

function describe(kw: string[]): string {
  if (!kw.length) return 'Mixed requests with no dominant theme.'
  const q = kw.slice(0, 3).map(w => `“${w}”`)
  return `Customers writing about ${q.length > 1 ? q.slice(0, -1).join(', ') + ' and ' + q[q.length - 1] : q[0]}.`
}

export function periodOf(tickets: Ticket[]) {
  const ds = tickets.map(t => t.createdAt).filter((x): x is number => x != null)
  if (!ds.length) return { periodStart: null, periodEnd: null, months: 1 }
  let lo = Infinity, hi = -Infinity
  for (const d of ds) { if (d < lo) lo = d; if (d > hi) hi = d }
  return { periodStart: lo, periodEnd: hi, months: Math.max(0.25, Math.round(((hi - lo) / 86400000 + 1) / 30.44 * 4) / 4) }
}

export interface AnalyzeInput {
  tickets: Ticket[]
  X: Vec[]
  embedder: Embedder
  id: string
  label: string
  source: Snapshot['source']
  k?: number
  previous?: Snapshot
  onProgress?: (stage: string, p: number) => void
}

/** Similarity a ticket needs to an existing intent centroid to join it when re-using a catalogue. */
export const REUSE_SIM: Record<Embedder, number> = { minilm: 0.45, lexical: 0.22 }

export function analyze(inp: AnalyzeInput): { snapshot: Snapshot; assign: Int32Array } {
  const { tickets, X } = inp
  let assign: Int32Array, k: number, kScores: Snapshot['kScores'] = [], keep: (Partial<Intent> | undefined)[] = []
  if (inp.previous && inp.previous.intents.length) {
    // Keep the existing catalogue: nearest existing intent if close enough, cluster the leftovers.
    const prevI = inp.previous.intents
    const C = prevI.map(i => unpackCentroid(i.centroid))
    assign = new Int32Array(X.length).fill(-1)
    const left: number[] = []
    X.forEach((x, i) => {
      let best = -1, bs = -Infinity
      C.forEach((c, j) => { const s = dot(x, c); if (s > bs) { bs = s; best = j } })
      if (bs >= REUSE_SIM[inp.embedder]) assign[i] = best; else left.push(i)
    })
    k = prevI.length
    keep = prevI.map(i => i)
    if (left.length >= 40) {
      const kk = Math.max(1, Math.min(6, Math.round(left.length / 60)))
      const sub = cluster(left.map(i => X[i]), kk)
      const nextId = Math.max(-1, ...prevI.map(i => +i.id.replace(/\D/g, '') || 0)) + 1
      for (let c = 0; c < kk; c++) keep.push({ id: `i${nextId + c}` })
      left.forEach((i, j) => (assign[i] = k + sub.assign[j]))
      k += kk
    } else {
      left.forEach(i => {
        let best = 0, bs = -Infinity
        C.forEach((c, j) => { const s = dot(X[i], c); if (s > bs) { bs = s; best = j } })
        assign[i] = best
      })
    }
  } else {
    inp.onProgress?.('Choosing the number of intents', 0)
    const choice = inp.k ? { k: inp.k, scores: [] } : chooseK(X, 6, 24, 7, p => inp.onProgress?.('Choosing the number of intents', p))
    k = choice.k; kScores = choice.scores
    inp.onProgress?.('Clustering', 0)
    assign = cluster(X, k).assign
  }
  inp.onProgress?.('Labelling and scoring intents', 0)
  // Renumber so cluster indices match the intents array after empty clusters drop out.
  const intents = buildIntents(tickets, X, assign, k, keep)
  const idToIdx = new Map(intents.map((it, i) => [it.id, i]))
  const oldIds = keep.length ? keep.map((p, c) => p?.id ?? `i${c}`) : Array.from({ length: k }, (_, c) => `i${c}`)
  const remap = oldIds.map(id => idToIdx.get(id) ?? -1)
  const finalAssign = Int32Array.from(assign, a => remap[a])
  return {
    snapshot: {
      id: inp.id, label: inp.label, createdAt: Date.now(), embedder: inp.embedder, source: inp.source,
      ...periodOf(tickets), total: tickets.length, k: intents.length, kScores, intents,
      reusedFrom: inp.previous?.id,
      catalogue: inp.previous ? inp.previous.catalogue : inp.id,
    },
    assign: finalAssign,
  }
}

/** Recompute all intents from an assignment (after merge/split), keeping ids, names and overrides. */
function rebuild(s: Snapshot, tickets: Ticket[], X: Vec[], assign: Int32Array, keep: (Partial<Intent> | undefined)[]): { snapshot: Snapshot; assign: Int32Array } {
  const k = keep.length
  const intents = buildIntents(tickets, X, assign, k, keep)
  const idToIdx = new Map(intents.map((it, i) => [it.id, i]))
  const remap = keep.map(p => idToIdx.get(p!.id!) ?? -1)
  return { snapshot: { ...s, intents, k: intents.length }, assign: Int32Array.from(assign, a => remap[a]) }
}

export function mergeIntents(s: Snapshot, tickets: Ticket[], X: Vec[], assign: Int32Array, ids: string[], name?: string) {
  const idx = ids.map(id => s.intents.findIndex(i => i.id === id)).filter(i => i >= 0)
  if (idx.length < 2) return { snapshot: s, assign }
  const target = Math.min(...idx)
  const a = Int32Array.from(assign, x => (idx.includes(x) ? target : x))
  const keep: Partial<Intent>[] = s.intents.map(i => ({ ...i }))
  const big = idx.map(i => s.intents[i]).sort((p, q) => q.size - p.size)[0]
  keep[target] = { id: s.intents[target].id, name: name ?? big.name, description: name ? undefined : big.description, kb: big.kb }
  for (const i of idx) if (i !== target) keep[i] = { id: `__gone${i}` }
  return rebuild(s, tickets, X, a, keep)
}

export function splitIntent(s: Snapshot, tickets: Ticket[], X: Vec[], assign: Int32Array, id: string, parts = 2) {
  const c = s.intents.findIndex(i => i.id === id)
  if (c < 0) return { snapshot: s, assign }
  const g = members(assign, c)
  if (g.length < parts * 4) return { snapshot: s, assign }
  const sub = kmeans(g.map(i => X[i]), parts, 11)
  const a = Int32Array.from(assign)
  const keep: Partial<Intent>[] = s.intents.map(i => ({ ...i }))
  const nextId = Math.max(...s.intents.map(i => +i.id.replace(/\D/g, '') || 0)) + 1
  keep[c] = { id }
  for (let p = 1; p < parts; p++) keep.push({ id: `i${nextId + p - 1}` })
  g.forEach((i, j) => { if (sub.assign[j] > 0) a[i] = s.intents.length + sub.assign[j] - 1 })
  return rebuild(s, tickets, X, a, keep)
}
