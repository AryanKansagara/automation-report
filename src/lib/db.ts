// Tiny IndexedDB wrapper. Two stores: projects (derived, syncable) and local
// (ticket text, vectors, layouts: never leaves the device).

import type { Snapshot } from '../engine/analyze.ts'
import type { RoiInputs } from '../engine/roi.ts'
import type { Ticket } from '../engine/formats.ts'
import type { Article } from '../engine/kb.ts'

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  syncedAt?: number
  deleted?: boolean
  roi: RoiInputs
  kb?: { source: string; count: number; fetchedAt: number }
  snapshots: Snapshot[]
  activeSnapshot?: string
  isSample?: boolean
}

export interface SnapshotLocal {
  id: string
  tickets: Ticket[]
  vec: Int8Array
  scales: Float32Array
  assign: Int32Array
  x: Float32Array
  y: Float32Array
  centers: { x: number; y: number; r: number }[]
}

export interface KbLocal { id: string; articles: Article[]; vec: Int8Array; scales: Float32Array }

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('automation-report', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects', { keyPath: 'id' })
      req.result.createObjectStore('local', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r ? r.result : (undefined as T))
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted (storage full?)'))
  }))
}

export const idb = {
  all: <T>(store: string) => tx<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>),
  get: <T>(store: string, id: string) => tx<T | undefined>(store, 'readonly', s => s.get(id) as IDBRequest<T | undefined>),
  put: (store: string, v: unknown) => tx<IDBValidKey>(store, 'readwrite', s => s.put(v)),
  del: (store: string, id: string) => tx<undefined>(store, 'readwrite', s => s.delete(id)),
  clear: (store: string) => tx<undefined>(store, 'readwrite', s => s.clear()),
}
