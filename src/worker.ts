// Embedding + clustering worker. The model downloads once (browser cache) and
// runs locally; ticket text never leaves this thread except back to the page.

import type { FeatureExtractionPipeline } from '@huggingface/transformers'
import { analyze, unpackCentroid, type Embedder, type Snapshot } from './engine/analyze.ts'
import { layout2d } from './engine/cluster.ts'
import { lexicalEmbed, ticketText } from './engine/lexical.ts'
import { parseCache } from './engine/embcache.ts'
import { quantize, textKey } from './engine/util.ts'
import type { Ticket } from './engine/formats.ts'

type Msg =
  | { type: 'analyze'; reqId: number; tickets: Ticket[]; embedder: Embedder; sampleCache: boolean; previous?: Snapshot; id: string; label: string; source: Snapshot['source'] }
  | { type: 'embed'; reqId: number; texts: string[]; embedder: Embedder; sampleCache: boolean }

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

let extractor: Promise<FeatureExtractionPipeline> | null = null
let sampleCache: Promise<Map<string, Float32Array>> | null = null

function loadModel(reqId: number) {
  return (extractor ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    const files = new Map<string, { loaded: number; total: number }>()
    const p = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'q8',
      progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status === 'progress' && e.file && e.total) {
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
          let l = 0, t = 0
          for (const f of files.values()) { l += f.loaded; t += f.total }
          post({ type: 'progress', reqId, stage: 'Downloading the embedding model (once, ~23 MB)', p: l / t, detail: `${(l / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)} MB` })
        }
      },
    })
    return p as FeatureExtractionPipeline
  })().catch(e => { extractor = null; throw e }))
}

function loadSampleCache() {
  return (sampleCache ??= fetch('/emb/sample.bin').then(r => { if (!r.ok) throw new Error('cache missing'); return r.arrayBuffer() }).then(parseCache).catch(() => new Map()))
}

async function embed(reqId: number, texts: string[], embedder: Embedder, useCache: boolean): Promise<{ X: Float32Array[]; embedder: Embedder; warning?: string }> {
  if (embedder === 'lexical') return { X: texts.map(lexicalEmbed), embedder }
  const cache = useCache ? await loadSampleCache() : new Map<string, Float32Array>()
  const X: (Float32Array | undefined)[] = texts.map(t => cache.get(textKey(t)))
  const missing = X.map((x, i) => (x ? -1 : i)).filter(i => i >= 0)
  if (!missing.length) {
    post({ type: 'progress', reqId, stage: 'Embedding tickets (precomputed cache)', p: 1 })
    return { X: X as Float32Array[], embedder }
  }
  let model: FeatureExtractionPipeline
  try { model = await loadModel(reqId) }
  catch (e) {
    return { X: texts.map(lexicalEmbed), embedder: 'lexical', warning: `Could not load the embedding model (${(e as Error).message}). Used the offline lexical embedder instead.` }
  }
  const B = 32
  for (let i = 0; i < missing.length; i += B) {
    const batch = missing.slice(i, i + B)
    const out = await model(batch.map(j => texts[j]), { pooling: 'mean', normalize: true })
    const d = out.data as Float32Array
    batch.forEach((j, b) => (X[j] = d.slice(b * 384, (b + 1) * 384)))
    post({ type: 'progress', reqId, stage: 'Embedding tickets on this device', p: Math.min(1, (i + B) / missing.length), detail: `${Math.min(missing.length, i + B).toLocaleString()} / ${missing.length.toLocaleString()}` })
  }
  return { X: X as Float32Array[], embedder }
}

function pack(X: Float32Array[]) {
  const vec = new Int8Array(X.length * 384), scales = new Float32Array(X.length)
  X.forEach((x, i) => { const { scale, q } = quantize(x); vec.set(q, i * 384); scales[i] = scale })
  return { vec, scales }
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data
  try {
    if (m.type === 'embed') {
      const r = await embed(m.reqId, m.texts, m.embedder, m.sampleCache)
      const { vec, scales } = pack(r.X)
      post({ type: 'done', reqId: m.reqId, result: { vec, scales, embedder: r.embedder, warning: r.warning } }, [vec.buffer, scales.buffer])
      return
    }
    const texts = m.tickets.map(ticketText)
    const r = await embed(m.reqId, texts, m.previous ? m.previous.embedder : m.embedder, m.sampleCache)
    const { snapshot, assign } = analyze({
      tickets: m.tickets, X: r.X, embedder: r.embedder, id: m.id, label: m.label, source: m.source,
      previous: m.previous && m.previous.embedder === r.embedder ? m.previous : undefined,
      onProgress: (stage, p) => post({ type: 'progress', reqId: m.reqId, stage, p }),
    })
    post({ type: 'progress', reqId: m.reqId, stage: 'Laying out the cluster map', p: 1 })
    const { x, y, centers } = layout2d(r.X, assign, snapshot.intents.map(i => unpackCentroid(i.centroid)))
    const { vec, scales } = pack(r.X)
    post({ type: 'done', reqId: m.reqId, result: { snapshot, assign, vec, scales, x, y, centers, warning: r.warning } }, [vec.buffer, scales.buffer, assign.buffer, x.buffer, y.buffer])
  } catch (e) {
    post({ type: 'error', reqId: m.reqId, message: (e as Error).message })
  }
}
