// In-memory project list backed by IndexedDB, with a subscribe hook for React.

import { useSyncExternalStore } from 'react'
import { idb, type Project, type SnapshotLocal, type KbLocal } from './db.ts'
import { DEFAULT_ROI, type RoiInputs } from '../engine/roi.ts'

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
let onChange: (() => void) | null = null
export const setChangeHook = (f: () => void) => { onChange = f }

export async function loadProjects() {
  projects = (await idb.all<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

export function useProjects(): { projects: Project[]; loaded: boolean } {
  const list = useSyncExternalStore(f => (subs.add(f), () => subs.delete(f)), () => projects)
  return { projects: list.filter(p => !p.deleted), loaded }
}

export const getProject = (id: string) => projects.find(p => p.id === id && !p.deleted)
export const allProjectsRaw = () => projects

/** Save a project. `touch` bumps updatedAt (user edits); sync writes pass false. */
export async function saveProject(p: Project, touch = true) {
  const next = touch ? { ...p, updatedAt: Date.now() } : p
  await idb.put('projects', next)
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next; else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  if (touch) onChange?.()
  return next
}

/** Removes a project row entirely (used by sync and undo-expiry). */
export async function purgeProject(id: string) {
  const p = projects.find(x => x.id === id)
  await idb.del('projects', id)
  for (const s of p?.snapshots ?? []) await idb.del('local', s.id)
  await idb.del('local', `kb:${id}`)
  projects = projects.filter(x => x.id !== id)
  emit()
}

export async function clearAll() {
  await idb.clear('projects'); await idb.clear('local')
  projects = []
  emit()
}

export const getLocal = (snapshotId: string) => idb.get<SnapshotLocal>('local', snapshotId)
export const putLocal = (v: SnapshotLocal | KbLocal) => idb.put('local', v)
export const delLocal = (id: string) => idb.del('local', id)
export const getKb = (projectId: string) => idb.get<KbLocal>('local', `kb:${projectId}`)

// ---------- settings (localStorage) ----------

export interface Settings { embedder: 'minilm' | 'lexical'; redactAddresses: boolean; redactNames: boolean; defaultRoi: RoiInputs; reuseCatalogue: boolean }
const SKEY = 'ar.settings'
const DEFAULTS: Settings = { embedder: 'minilm', redactAddresses: true, redactNames: true, defaultRoi: DEFAULT_ROI, reuseCatalogue: true }
let settings: Settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) ?? '{}') } } catch { return DEFAULTS } })()
const ssubs = new Set<() => void>()
export function useSettings(): Settings { return useSyncExternalStore(f => (ssubs.add(f), () => ssubs.delete(f)), () => settings) }
export function getSettings() { return settings }
export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  localStorage.setItem(SKEY, JSON.stringify(settings))
  ssubs.forEach(f => f())
}
export const resetSettings = () => { localStorage.removeItem(SKEY); settings = DEFAULTS; ssubs.forEach(f => f()) }

// ---------- toasts ----------

export interface Toast { id: number; text: string; kind?: 'ok' | 'error' | 'info'; undo?: () => void; ms?: number }
let toasts: Toast[] = []
const tsubs = new Set<() => void>()
let tid = 0
export function useToasts() { return useSyncExternalStore(f => (tsubs.add(f), () => tsubs.delete(f)), () => toasts) }
export function toast(t: Omit<Toast, 'id'>) {
  const id = ++tid
  toasts = [...toasts, { ...t, id }]
  tsubs.forEach(f => f())
  setTimeout(() => dismiss(id), t.ms ?? (t.undo ? 7000 : 4000))
  return id
}
export function dismiss(id: number) { toasts = toasts.filter(t => t.id !== id); tsubs.forEach(f => f()) }

export const uuid = () => crypto.randomUUID()
