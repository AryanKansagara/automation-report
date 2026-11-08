// Small numeric and text helpers shared by the engine.

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 64-bit-ish FNV-1a over two lanes, as 16 hex chars. Used as the embedding cache key. */
export function textKey(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

const STOP_WORDS = `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves hi hello hey thanks thank please pls regards dear team support im ive dont cant wont didnt doesnt also just get got still yet would like need want know one two us via re fw fwd ok okay sure yes hope help much really can could ago since today yesterday week day days time asap let know thing things way`.split(' ')
// Tokens lose their apostrophes, so keep both spellings ("haven't" and "havent").
export const STOP = new Set([...STOP_WORDS, ...STOP_WORDS.map(w => w.replace(/'/g, ''))])

export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/\[[a-z_]+\]/g, ' ').match(/[a-z][a-z'’-]{1,}/g)?.map(t => t.replace(/['’]s$/, '').replace(/['’-]/g, '')).filter(t => t.length > 2 && !STOP.has(t)) ?? []
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

/** Per-vector int8 quantization: [scale float32][dim int8]. Cosine survives within ~0.5%. */
export function quantize(v: ArrayLike<number>): { scale: number; q: Int8Array } {
  let m = 0
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]))
  const scale = m / 127 || 1
  const q = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / scale)
  return { scale, q }
}

export function dequantize(q: Int8Array, scale: number): Float32Array {
  const v = new Float32Array(q.length)
  for (let i = 0; i < q.length; i++) v[i] = q[i] * scale
  return normalize(v)
}

export function median(xs: number[]): number | null {
  const s = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
