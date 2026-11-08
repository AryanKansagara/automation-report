// User-level operations: import a snapshot, the sample, edits with undo, KB import, backups.

import { saveProject, getProject, getLocal, putLocal, delLocal, getKb, purgeProject, toast, uuid, getSettings, allProjectsRaw, loadProjects } from './store.ts'
import type { Project, SnapshotLocal } from './db.ts'
import { idb } from './db.ts'
import { runAnalysis, embedTexts, unpackAll, type Progress } from './pipeline.ts'
import type { Ticket, ValidationReport } from '../engine/formats.ts'
import { normalizeJson } from '../engine/formats.ts'
import { mergeIntents, splitIntent, type Intent, type Snapshot } from '../engine/analyze.ts'
import { layout2d } from '../engine/cluster.ts'
import { unpackCentroid } from '../engine/analyze.ts'
import { matchArticles, articleText, type Article } from '../engine/kb.ts'
import { sampleNdjson, SAMPLE_ARTICLES, SAMPLE_MONTHS } from '../engine/sample.ts'
import type { Tier } from '../engine/score.ts'

export function periodLabel(tickets: Ticket[], fallback: string) {
  const ds = tickets.map(t => t.createdAt).filter((x): x is number => x != null).sort((a, b) => a - b)
  if (!ds.length) return fallback
  const f = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  const a = f(ds[Math.floor(ds.length * 0.02)]), b = f(ds[Math.floor(ds.length * 0.98)])
  return a === b ? a : `${a} – ${b}`
}

export function newProject(name: string, isSample = false): Project {
  const now = Date.now()
  return { id: uuid(), name, createdAt: now, updatedAt: now, roi: structuredClone(getSettings().defaultRoi), snapshots: [], isSample }
}

export async function importSnapshot(o: {
  project: Project; tickets: Ticket[]; report: ValidationReport; fileName: string; label: string; reuse: boolean; sampleCache?: boolean; onProgress?: (p: Progress) => void
}): Promise<Project> {
  const previous = o.reuse ? o.project.snapshots[o.project.snapshots.length - 1] : undefined
  const id = uuid()
  const r = await runAnalysis({
    tickets: o.tickets, embedder: getSettings().embedder, sampleCache: !!o.sampleCache, previous, id, label: o.label,
    source: { format: o.report.format, fileName: o.fileName, total: o.report.total, imported: o.report.imported, pii: o.report.pii },
  }, o.onProgress)
  if (r.warning) toast({ text: r.warning, kind: 'error', ms: 9000 })
  let snapshot = r.snapshot
  const kb = await getKb(o.project.id)
  if (kb && kb.articles.length) snapshot = { ...snapshot, intents: matchArticles(snapshot.intents, kb.articles, unpackAll(kb.vec, kb.scales), snapshot.embedder) }
  const local: SnapshotLocal = { id, tickets: o.tickets, vec: r.vec, scales: r.scales, assign: r.assign, x: r.x, y: r.y, centers: r.centers }
  await putLocal(local)
  return saveProject({ ...o.project, snapshots: [...o.project.snapshots, snapshot], activeSnapshot: id })
}

/** Creates (or reopens) the sample project: two months, catalogue re-used, help centre attached. */
export async function openSample(onProgress?: (p: Progress) => void): Promise<Project> {
  const existing = allProjectsRaw().find(p => p.isSample && !p.deleted && p.snapshots.length === 2)
  if (existing) return existing
  let project = newProject('Northwind Outfitters (synthetic sample)', true)
  project.roi = { ...project.roi }
  // Help centre first so both snapshots get matched.
  onProgress?.({ stage: 'Loading the sample help centre', p: 0 })
  const kb = await embedTexts(SAMPLE_ARTICLES.map(articleText), getSettings().embedder, true)
  await putLocal({ id: `kb:${project.id}`, articles: SAMPLE_ARTICLES, vec: kb.vec, scales: kb.scales })
  project.kb = { source: 'Sample help centre (8 articles)', count: SAMPLE_ARTICLES.length, fetchedAt: Date.now() }
  for (const m of [0, 1] as const) {
    const { tickets, report } = normalizeJson(sampleNdjson(m))
    project = await importSnapshot({
      project, tickets, report, fileName: `northwind-${SAMPLE_MONTHS[m].key}-2026.json`, label: SAMPLE_MONTHS[m].label, reuse: m === 1, sampleCache: true,
      onProgress: p => onProgress?.({ ...p, stage: `${SAMPLE_MONTHS[m].label.split(' · ')[0]}: ${p.stage}` }),
    })
  }
  return saveProject({ ...project, activeSnapshot: project.snapshots[0].id })
}

// ---------- edits with undo ----------

async function withUndo(projectId: string, text: string, fn: (p: Project) => Promise<Project | void>, localsTouched: string[] = []) {
  const before = getProject(projectId)
  if (!before) return
  const savedLocals = await Promise.all(localsTouched.map(id => getLocal(id)))
  await fn(before)
  toast({
    text, kind: 'ok',
    undo: async () => {
      for (const l of savedLocals) if (l) await putLocal(l)
      await saveProject(before)
    },
  })
}

export function updateSnapshot(p: Project, s: Snapshot) {
  return saveProject({ ...p, snapshots: p.snapshots.map(x => (x.id === s.id ? s : x)) })
}

export function patchIntent(p: Project, s: Snapshot, id: string, patch: Partial<Intent>) {
  return updateSnapshot(p, { ...s, intents: s.intents.map(i => (i.id === id ? { ...i, ...patch } : i)) })
}

export function setOverride(p: Project, s: Snapshot, id: string, tier: Tier | undefined) {
  return patchIntent(p, s, id, { override: tier })
}

async function relayout(local: SnapshotLocal, s: Snapshot, assign: Int32Array) {
  const X = unpackAll(local.vec, local.scales)
  const l = layout2d(X, assign, s.intents.map(i => unpackCentroid(i.centroid)))
  await putLocal({ ...local, assign, x: l.x, y: l.y, centers: l.centers })
}

export async function merge(projectId: string, snapId: string, ids: string[], name?: string) {
  await withUndo(projectId, `Merged ${ids.length} intents`, async p => {
    const s = p.snapshots.find(x => x.id === snapId)!
    const local = await getLocal(snapId)
    if (!local) throw new Error('Ticket data for this snapshot is not on this device')
    const X = unpackAll(local.vec, local.scales)
    const r = mergeIntents(s, local.tickets, X, local.assign, ids, name)
    await relayout(local, r.snapshot, r.assign)
    await updateSnapshot(p, r.snapshot)
  }, [snapId])
}

export async function split(projectId: string, snapId: string, id: string) {
  await withUndo(projectId, 'Split into two intents', async p => {
    const s = p.snapshots.find(x => x.id === snapId)!
    const local = await getLocal(snapId)
    if (!local) throw new Error('Ticket data for this snapshot is not on this device')
    const X = unpackAll(local.vec, local.scales)
    const r = splitIntent(s, local.tickets, X, local.assign, id)
    if (r.snapshot === s) { toast({ text: 'Too few tickets to split', kind: 'error' }); return }
    await relayout(local, r.snapshot, r.assign)
    await updateSnapshot(p, r.snapshot)
  }, [snapId])
}

export async function deleteProject(id: string) {
  const p = getProject(id)
  if (!p) return
  await saveProject({ ...p, deleted: true })
  toast({
    text: `Deleted “${p.name}”`, kind: 'ok',
    undo: () => saveProject({ ...p, deleted: false }),
  })
  // Local-only projects can be purged once the undo window has passed; synced ones are purged by sync.
  setTimeout(() => { const q = allProjectsRaw().find(x => x.id === id); if (q?.deleted && !q.syncedAt) void purgeProject(id) }, 8000)
}

export async function deleteSnapshot(p: Project, snapId: string) {
  const s = p.snapshots.find(x => x.id === snapId)
  if (!s) return
  const local = await getLocal(snapId)
  const remaining = p.snapshots.filter(x => x.id !== snapId)
  await saveProject({ ...p, snapshots: remaining, activeSnapshot: remaining[remaining.length - 1]?.id })
  toast({
    text: `Deleted snapshot “${s.label}”`, kind: 'ok',
    undo: async () => { if (local) await putLocal(local); const cur = getProject(p.id) ?? p; await saveProject({ ...cur, snapshots: p.snapshots, activeSnapshot: snapId }) },
  })
  setTimeout(() => { if (!getProject(p.id)?.snapshots.some(x => x.id === snapId)) void delLocal(snapId) }, 8000)
}

// ---------- knowledge base ----------

export async function fetchHelpCenter(url: string, onProgress?: (n: number) => void): Promise<Article[]> {
  const out: Article[] = []
  let next: string | null = url
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetch(next)
    if (!res.ok) throw new Error(res.status === 404 ? 'No public Help Center found at that address' : `Help Center API returned ${res.status}`)
    const j = await res.json()
    for (const a of j.articles ?? []) if (!a.draft) out.push({ id: String(a.id), title: a.title, body: String(a.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000), url: a.html_url })
    onProgress?.(out.length)
    next = j.next_page
  }
  return out
}

export async function attachArticles(projectId: string, articles: Article[], source: string, onProgress?: (p: Progress) => void) {
  const p = getProject(projectId)
  if (!p) return
  const embedder = p.snapshots[p.snapshots.length - 1]?.embedder ?? getSettings().embedder
  const r = await embedTexts(articles.map(articleText), embedder, !!p.isSample, onProgress)
  await putLocal({ id: `kb:${projectId}`, articles, vec: r.vec, scales: r.scales })
  const AV = unpackAll(r.vec, r.scales)
  const snapshots = p.snapshots.map(s => (s.embedder === r.embedder ? { ...s, intents: matchArticles(s.intents, articles, AV, s.embedder) } : s))
  return saveProject({ ...p, snapshots, kb: { source, count: articles.length, fetchedAt: Date.now() } })
}

// ---------- backup ----------

const b64 = (u: ArrayBufferView) => { let s = ''; const b = new Uint8Array(u.buffer, u.byteOffset, u.byteLength); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer

export async function exportAll(): Promise<string> {
  const projects = allProjectsRaw().filter(p => !p.deleted)
  const locals = (await idb.all<any>('local')).map(l => {
    const o: Record<string, unknown> = { ...l }
    for (const k of ['vec', 'scales', 'assign', 'x', 'y']) if (l[k]) o[k] = { b64: b64(l[k]), type: l[k].constructor.name }
    return o
  })
  return JSON.stringify({ app: 'automation-report', version: 1, exportedAt: new Date().toISOString(), projects, local: locals })
}

export async function importAll(text: string) {
  const j = JSON.parse(text)
  if (j.app !== 'automation-report') throw new Error('This is not an Automation Report backup')
  const T: Record<string, any> = { Int8Array, Float32Array, Int32Array }
  for (const l of j.local ?? []) {
    for (const k of ['vec', 'scales', 'assign', 'x', 'y']) if (l[k]?.b64) l[k] = new T[l[k].type](unb64(l[k].b64))
    await putLocal(l)
  }
  for (const p of j.projects ?? []) await idb.put('projects', { ...p, syncedAt: undefined, updatedAt: Date.now() })
  await loadProjects()
  return (j.projects ?? []).length as number
}
