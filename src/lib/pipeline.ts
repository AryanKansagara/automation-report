// Page-side client for the worker, plus helpers to rebuild vectors from storage.

import type { Embedder, Snapshot } from '../engine/analyze.ts'
import type { Ticket } from '../engine/formats.ts'
import { dequantize } from '../engine/util.ts'

export interface Progress { stage: string; p: number; detail?: string }
export interface AnalyzeResult { snapshot: Snapshot; assign: Int32Array; vec: Int8Array; scales: Float32Array; x: Float32Array; y: Float32Array; centers: { x: number; y: number; r: number }[]; warning?: string }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: Progress) => void }>()

function w(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data, h = pending.get(m.reqId)
    if (!h) return
    if (m.type === 'progress') h.onProgress?.(m)
    else { pending.delete(m.reqId); m.type === 'done' ? h.resolve(m.result) : h.reject(new Error(m.message)) }
  }
  worker.onerror = e => { for (const h of pending.values()) h.reject(new Error(e.message || 'Worker crashed')); pending.clear(); worker = null }
  return worker
}

function call<T>(msg: object, onProgress?: (p: Progress) => void): Promise<T> {
  const reqId = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(reqId, { resolve, reject, onProgress })
    w().postMessage({ ...msg, reqId })
  })
}

export const runAnalysis = (a: { tickets: Ticket[]; embedder: Embedder; sampleCache: boolean; previous?: Snapshot; id: string; label: string; source: Snapshot['source'] }, onProgress?: (p: Progress) => void) =>
  call<AnalyzeResult>({ type: 'analyze', ...a }, onProgress)

export const embedTexts = (texts: string[], embedder: Embedder, sampleCache: boolean, onProgress?: (p: Progress) => void) =>
  call<{ vec: Int8Array; scales: Float32Array; embedder: Embedder; warning?: string }>({ type: 'embed', texts, embedder, sampleCache }, onProgress)

export function unpackAll(vec: Int8Array, scales: Float32Array): Float32Array[] {
  return Array.from(scales, (s, i) => dequantize(vec.subarray(i * 384, (i + 1) * 384), s))
}
