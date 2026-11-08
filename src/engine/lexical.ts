// Offline fallback embedder: hashed unigrams + bigrams with sublinear tf,
// projected into the same 384 dims as MiniLM so the rest of the pipeline is identical.

import { tokens, normalize, textKey } from './util.ts'

export const DIM = 384

function bucket(s: string): [number, number] {
  const h = parseInt(textKey(s).slice(0, 8), 16)
  return [h % DIM, h & 0x80000000 ? -1 : 1]
}

export function lexicalEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM)
  const toks = tokens(text)
  const counts = new Map<string, number>()
  toks.forEach((t, i) => {
    counts.set(t, (counts.get(t) ?? 0) + 1)
    if (i) counts.set(toks[i - 1] + ' ' + t, (counts.get(toks[i - 1] + ' ' + t) ?? 0) + 0.7)
  })
  for (const [t, c] of counts) { const [i, s] = bucket(t); v[i] += s * (1 + Math.log(c)) }
  return normalize(v)
}

/** Text that represents a ticket for embedding: subject plus the first part of the body. */
export function ticketText(t: { subject: string; body: string }): string {
  const s = t.subject.trim(), b = t.body.trim()
  const text = s && !b.toLowerCase().startsWith(s.toLowerCase()) ? `${s}. ${b}` : b || s
  return text.slice(0, 600)
}
