// Optional cloud sync via Supabase. Local-first: the app never waits on this.
// Only derived reports sync (project settings + snapshot summaries); ticket
// text, embeddings and help-centre article bodies stay on this device.

import { useSyncExternalStore } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { allProjectsRaw, saveProject, purgeProject, setChangeHook } from './store.ts'
import type { Project } from './db.ts'
import type { Snapshot } from '../engine/analyze.ts'

export const APP_ID = 'automation-report'
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'
interface State { status: SyncStatus; email: string | null; error?: string; lastSync?: number }
let state: State = { status: 'local', email: null }
const subs = new Set<() => void>()
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach(f => f()) }
export const useSync = () => useSyncExternalStore(f => (subs.add(f), () => subs.delete(f)), () => state)

let client: SupabaseClient | null = null
async function sb(): Promise<SupabaseClient> {
  if (client) return client
  if (!URL || !KEY) throw new Error('Cloud sync is not configured for this build')
  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  client.auth.onAuthStateChange((_e, session) => onSession(session))
  return client
}

function onSession(s: Session | null) {
  if (s?.user) {
    if (state.email !== s.user.email) { set({ email: s.user.email ?? 'signed in' }); void syncNow() }
  } else set({ email: null, status: 'local' })
}

/** Only load supabase-js at startup if a session was stored by a previous visit. */
export async function initSync() {
  setChangeHook(scheduleSync)
  const hasSession = Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
  if (!hasSession) return
  try {
    const c = await sb()
    const { data } = await c.auth.getSession()
    onSession(data.session)
  } catch { set({ status: 'offline' }) }
  window.addEventListener('online', () => state.email && void syncNow())
}

export async function signUp(email: string, password: string) {
  const c = await sb()
  const { data, error } = await c.auth.signUp({ email, password })
  if (error) throw error
  if (!data.session) throw new Error('Account created. Sign in to continue.')
  onSession(data.session)
}
export async function signIn(email: string, password: string) {
  const c = await sb()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  onSession(data.session)
}
export async function signOut() {
  const c = await sb()
  await c.auth.signOut()
  set({ email: null, status: 'local' })
}

let timer: ReturnType<typeof setTimeout> | undefined
export function scheduleSync() {
  if (!state.email) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), 1200)
}

interface Row { id: string; name: string; data: { project: Omit<Project, 'snapshots'>; snapshotIds: string[] }; updated_at: string }

function slim(p: Project) {
  const { snapshots, syncedAt, ...rest } = p
  void syncedAt
  return { project: rest, snapshotIds: snapshots.map(s => s.id) }
}

let running: Promise<void> | null = null
export function syncNow(): Promise<void> {
  if (!state.email) return Promise.resolve()
  return (running ??= doSync().finally(() => { running = null }))
}

async function doSync() {
  if (!navigator.onLine) { set({ status: 'offline' }); return }
  set({ status: 'syncing', error: undefined })
  try {
    const c = await sb()
    const { data: rows, error } = await c.from('projects').select('id,name,data,updated_at').eq('app', APP_ID)
    if (error) throw error
    const remote = new Map((rows as Row[]).map(r => [r.id, r]))
    const local = new Map(allProjectsRaw().map(p => [p.id, p]))
    for (const id of new Set([...remote.keys(), ...local.keys()])) {
      const L = local.get(id), R = remote.get(id)
      if (L?.deleted) {
        if (R) { await c.from('project_versions').delete().eq('project_id', id); await c.from('projects').delete().eq('id', id) }
        await purgeProject(id)
      } else if (L && !R) {
        // Never seen remotely: push. Seen before but gone remotely: deleted elsewhere, unless edited since.
        if (L.syncedAt && L.updatedAt <= L.syncedAt) await purgeProject(id)
        else await push(c, L)
      } else if (R && !L) await pull(c, R)
      else if (L && R) {
        const rt = Date.parse(R.updated_at)
        if (rt > L.updatedAt) await pull(c, R)
        else if (L.updatedAt > rt) await push(c, L)
        else if (!L.syncedAt) await saveProject({ ...L, syncedAt: L.updatedAt }, false)
      }
    }
    set({ status: 'synced', lastSync: Date.now() })
  } catch (e) {
    set({ status: navigator.onLine ? 'error' : 'offline', error: (e as Error).message })
  }
}

async function push(c: SupabaseClient, p: Project) {
  const updated_at = new Date(p.updatedAt).toISOString()
  const { error } = await c.from('projects').upsert({ id: p.id, app: APP_ID, name: p.name, data: slim(p), updated_at })
  if (error) throw error
  if (p.snapshots.length) {
    const { error: e2 } = await c.from('project_versions').upsert(p.snapshots.map(s => ({ id: s.id, project_id: p.id, label: s.label, data: s })))
    if (e2) throw e2
  }
  const ids = p.snapshots.map(s => s.id)
  let q = c.from('project_versions').delete().eq('project_id', p.id)
  if (ids.length) q = q.not('id', 'in', `(${ids.join(',')})`)
  const { error: e3 } = await q
  if (e3) throw e3
  await saveProject({ ...p, syncedAt: p.updatedAt }, false)
}

async function pull(c: SupabaseClient, r: Row) {
  const { data, error } = await c.from('project_versions').select('id,data').eq('project_id', r.id)
  if (error) throw error
  const byId = new Map((data as { id: string; data: Snapshot }[]).map(v => [v.id, v.data]))
  const snapshots = r.data.snapshotIds.map(id => byId.get(id)).filter((s): s is Snapshot => !!s)
  const t = Date.parse(r.updated_at)
  await saveProject({ ...r.data.project, name: r.name, snapshots, updatedAt: t, syncedAt: t } as Project, false)
}

export async function deleteCloudData() {
  const c = await sb()
  const { data } = await c.from('projects').select('id').eq('app', APP_ID)
  const ids = (data ?? []).map((r: { id: string }) => r.id)
  if (ids.length) {
    const { error: e1 } = await c.from('project_versions').delete().in('project_id', ids)
    if (e1) throw e1
    const { error: e2 } = await c.from('projects').delete().in('id', ids)
    if (e2) throw e2
  }
  // Local copies stay; mark them unsynced so a later sync does not treat them as deleted elsewhere.
  for (const p of allProjectsRaw()) await saveProject({ ...p, syncedAt: undefined }, false)
  set({ status: 'synced' })
}

export async function deleteAccount() {
  const c = await sb()
  await deleteCloudData()
  const { error } = await c.rpc('delete_my_account')
  if (error) throw error
  await c.auth.signOut()
  set({ email: null, status: 'local' })
}
