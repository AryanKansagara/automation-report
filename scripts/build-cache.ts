// Precomputes MiniLM embeddings for the synthetic sample and the landing-page hero,
// using the exact same normalize -> redact -> clean -> ticketText path as the app.
// Output: public/emb/{sample,hero}.bin, records of [8-byte key][float32 scale][384 x int8].
import { writeFileSync } from 'node:fs'
import { pipeline } from '@huggingface/transformers'
import { sampleNdjson, SAMPLE_ARTICLES } from '../src/engine/sample.ts'
import { normalizeJson } from '../src/engine/formats.ts'
import { ticketText } from '../src/engine/lexical.ts'
import { articleText } from '../src/engine/kb.ts'
import { textKey, quantize } from '../src/engine/util.ts'

export const HERO_COUNT = 320
const ext = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' })

async function embedAll(texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += 64) {
    const t = await ext(texts.slice(i, i + 64), { pooling: 'mean', normalize: true })
    const d = t.data as Float32Array
    for (let j = 0; j < t.dims[0]; j++) out.push(d.slice(j * 384, (j + 1) * 384))
  }
  return out
}

function pack(texts: string[], vecs: Float32Array[]): Buffer {
  const seen = new Set<string>()
  const recs: Buffer[] = []
  texts.forEach((t, i) => {
    const key = textKey(t)
    if (seen.has(key)) return
    seen.add(key)
    const { scale, q } = quantize(vecs[i])
    const b = Buffer.alloc(8 + 4 + 384)
    b.write(key, 0, 'hex')
    b.writeFloatLE(scale, 8)
    Buffer.from(q.buffer).copy(b, 12)
    recs.push(b)
  })
  return Buffer.concat(recs)
}

const m0 = normalizeJson(sampleNdjson(0)).tickets.map(ticketText)
const m1 = normalizeJson(sampleNdjson(1)).tickets.map(ticketText)
const arts = SAMPLE_ARTICLES.map(articleText)
const all = [...m0, ...m1, ...arts]
const t0 = Date.now()
const vecs = await embedAll(all)
writeFileSync('public/emb/sample.bin', pack(all, vecs))
writeFileSync('public/emb/hero.bin', pack(m0.slice(0, HERO_COUNT), vecs.slice(0, HERO_COUNT)))
console.log(`embedded ${all.length} texts in ${Date.now() - t0} ms`)
