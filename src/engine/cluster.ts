// Intent discovery: seeded spherical k-means, k chosen by sampled silhouette,
// c-TF-IDF labels, representative tickets and a 2D layout for the cluster map.

import { dot, mulberry32, normalize, tokens } from './util.ts'

export type Vec = Float32Array

export interface KMeans { assign: Int32Array; centroids: Vec[]; inertia: number }

function addInto(a: Vec, b: Vec) { for (let i = 0; i < a.length; i++) a[i] += b[i] }

export function kmeans(X: Vec[], k: number, seed = 7, iters = 40): KMeans {
  const n = X.length, rnd = mulberry32(seed)
  k = Math.max(1, Math.min(k, n))
  // k-means++ with cosine distance
  const centroids: Vec[] = [Float32Array.from(X[Math.floor(rnd() * n)])]
  const d = new Float64Array(n).fill(Infinity)
  while (centroids.length < k) {
    const c = centroids[centroids.length - 1]
    let total = 0
    for (let i = 0; i < n; i++) { d[i] = Math.min(d[i], Math.max(0, 1 - dot(X[i], c)) ** 2); total += d[i] }
    let r = rnd() * total, pick = n - 1
    for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break } }
    centroids.push(Float32Array.from(X[pick]))
  }
  const assign = new Int32Array(n).fill(-1)
  let inertia = 0
  for (let it = 0; it < iters; it++) {
    let changed = 0
    inertia = 0
    for (let i = 0; i < n; i++) {
      let best = 0, bs = -Infinity
      for (let j = 0; j < k; j++) { const s = dot(X[i], centroids[j]); if (s > bs) { bs = s; best = j } }
      if (assign[i] !== best) { assign[i] = best; changed++ }
      inertia += 1 - bs
    }
    const sums = centroids.map(c => new Float32Array(c.length))
    const counts = new Int32Array(k)
    for (let i = 0; i < n; i++) { addInto(sums[assign[i]], X[i]); counts[assign[i]]++ }
    for (let j = 0; j < k; j++) {
      // Re-seed an empty cluster with the worst-fitting point.
      if (!counts[j]) {
        let worst = 0, ws = Infinity
        for (let i = 0; i < n; i++) { const s = dot(X[i], centroids[assign[i]]); if (s < ws) { ws = s; worst = i } }
        centroids[j] = Float32Array.from(X[worst])
        changed++
      } else centroids[j] = normalize(sums[j])
    }
    if (!changed) break
  }
  return { assign, centroids, inertia }
}

/** Mean silhouette with cosine distance over the given sample indices. */
export function silhouette(X: Vec[], assign: ArrayLike<number>, idx: number[]): number {
  const k = Math.max(...Array.from(idx, i => assign[i])) + 1
  let total = 0, count = 0
  for (const i of idx) {
    const sum = new Float64Array(k), cnt = new Int32Array(k)
    for (const j of idx) {
      if (i === j) continue
      sum[assign[j]] += 1 - dot(X[i], X[j]); cnt[assign[j]]++
    }
    const own = assign[i]
    if (!cnt[own]) continue
    const a = sum[own] / cnt[own]
    let b = Infinity
    for (let c = 0; c < k; c++) if (c !== own && cnt[c]) b = Math.min(b, sum[c] / cnt[c])
    if (!Number.isFinite(b)) continue
    total += (b - a) / Math.max(a, b); count++
  }
  return count ? total / count : 0
}

export function sampleIdx(n: number, m: number, seed = 3): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  const rnd = mulberry32(seed)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
  return idx.slice(0, Math.min(n, m))
}

export interface KChoice { k: number; scores: { k: number; s: number }[] }

/** Pick k by silhouette on a sample of tickets. */
export function chooseK(X: Vec[], kMin = 6, kMax = 22, seed = 7, onProgress?: (p: number) => void): KChoice {
  const S = sampleIdx(X.length, 450, seed)
  const XS = S.map(i => X[i])
  const all = XS.map((_, i) => i)
  const hi = Math.min(kMax, Math.floor(XS.length / 8))
  const lo = Math.min(kMin, Math.max(2, hi))
  const scores: KChoice['scores'] = []
  const tried = new Set<number>()
  const tryK = (k: number) => {
    if (k < lo || k > hi || tried.has(k)) return
    tried.add(k)
    scores.push({ k, s: silhouette(XS, kmeans(XS, k, seed, 25).assign, all) })
  }
  // Coarse pass in steps of 2, then refine around the best.
  const coarse: number[] = []
  for (let k = lo; k <= hi; k += 2) coarse.push(k)
  coarse.forEach((k, i) => { tryK(k); onProgress?.((i + 1) / (coarse.length + 2)) })
  if (!scores.length) return { k: Math.max(1, Math.min(X.length, 2)), scores }
  const top = scores.reduce((a, b) => (b.s > a.s ? b : a)).k
  tryK(top - 1); tryK(top + 1)
  onProgress?.(1)
  scores.sort((a, b) => a.k - b.k)
  // Silhouette tends to creep up with k on templated support text; take the
  // smallest k that gets within 12% of the best (users can split later).
  const best = Math.max(...scores.map(s => s.s))
  const k = Math.min(...scores.filter(s => s.s >= best * 0.88).map(s => s.k))
  return { k, scores }
}

/** Best of a few seeded restarts. */
export function cluster(X: Vec[], k: number, seed = 7): KMeans {
  let best: KMeans | null = null
  for (let r = 0; r < 3; r++) {
    const m = kmeans(X, k, seed + r * 101)
    if (!best || m.inertia < best.inertia) best = m
  }
  return best!
}

// ---------- labels ----------

/** Class-based TF-IDF (BERTopic style): which terms are distinctive for each cluster. */
export function cTfidf(docs: string[], assign: ArrayLike<number>, k: number, top = 6): string[][] {
  const tf = Array.from({ length: k }, () => new Map<string, number>())
  const words = new Float64Array(k)
  docs.forEach((d, i) => {
    const m = tf[assign[i]]
    if (!m) return
    // Bigrams never cross sentence boundaries.
    const segs = d.split(/[.!?\n]+/).map(tokens)
    const t = segs.flat()
    const grams = [...t, ...segs.flatMap(sg => sg.slice(1).map((w, j) => sg[j] + ' ' + w))]
    for (const g of new Set(grams)) m.set(g, (m.get(g) ?? 0) + 1)
    words[assign[i]] += t.length
  })
  const freq = new Map<string, number>()
  for (const m of tf) for (const [g, c] of m) freq.set(g, (freq.get(g) ?? 0) + c)
  const avg = words.reduce((a, b) => a + b, 0) / k || 1
  return tf.map((m, c) => {
    const size = Math.max(1, Array.from(assign).filter(a => a === c).length)
    const scored = [...m].filter(([, n]) => n >= Math.max(2, size * 0.04)).map(([g, n]) => [g, (n / Math.max(1, words[c])) * Math.log(1 + avg / freq.get(g)!) * (g.includes(' ') ? 1.2 : 1)] as const)
    scored.sort((a, b) => b[1] - a[1])
    const out: string[] = []
    for (const [g] of scored) {
      if (out.some(o => o.includes(g) || g.includes(o))) continue
      out.push(g)
      if (out.length === top) break
    }
    return out
  })
}

/** The customers' own subject line, when enough of them use the same one (digits folded). */
export function nameFromSubjects(subjects: string[]): string | null {
  const counts = new Map<string, { n: number; text: string }>()
  for (const raw of subjects) {
    const text = raw.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').replace(/#?\d[\d-]{2,}/g, '').replace(/\s+(#|for|on|of)?\s*$/i, '').replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase().replace(/[?!.]+$/, '')
    if (key.split(' ').length < 2 || /\[|no subject|^(question|follow up|request|help|inquiry)$/i.test(key)) continue
    const c = counts.get(key) ?? { n: 0, text }
    c.n++
    counts.set(key, c)
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]
  return best && best.n >= Math.max(3, subjects.length * 0.12) ? best.text.replace(/[.]+$/, '') : null
}

export function nameFromKeywords(kw: string[]): string {
  if (!kw.length) return 'Unlabelled intent'
  const first = kw[0]
  const second = kw.find(w => w !== first && !first.includes(w))
  const s = second && !first.includes(' ') ? `${first} ${second}` : first
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Indices of members ordered by similarity to the centroid (most typical first). */
export function byTypicality(X: Vec[], members: number[], centroid: Vec): { i: number; s: number }[] {
  return members.map(i => ({ i, s: dot(X[i], centroid) })).sort((a, b) => b.s - a.s)
}

/** Diverse but typical examples: farthest-point picks among the most typical third. */
export function diverseExamples(X: Vec[], ranked: { i: number }[], n: number): number[] {
  const pool = ranked.slice(0, Math.max(n, Math.ceil(ranked.length / 3))).map(r => r.i)
  if (!pool.length) return []
  const out = [pool[0]]
  while (out.length < Math.min(n, pool.length)) {
    let best = -1, bd = -Infinity
    for (const i of pool) {
      if (out.includes(i)) continue
      const d = Math.min(...out.map(o => 1 - dot(X[i], X[o])))
      if (d > bd) { bd = d; best = i }
    }
    out.push(best)
  }
  return out
}

export function centroidOf(X: Vec[], members: number[]): Vec {
  const c = new Float32Array(X[0]?.length ?? 384)
  for (const i of members) addInto(c, X[i])
  return normalize(c)
}

// ---------- 2D layout ----------

function topEigen2(B: number[][]): [number[], number[], number, number] {
  const n = B.length
  const power = (orth?: number[]) => {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + 1) + 0.1)
    let lambda = 0
    for (let it = 0; it < 200; it++) {
      if (orth) { const p = v.reduce((a, x, i) => a + x * orth[i], 0); v = v.map((x, i) => x - p * orth[i]) }
      const w = B.map(row => row.reduce((a, x, j) => a + x * v[j], 0))
      const norm = Math.hypot(...w) || 1
      lambda = norm
      v = w.map(x => x / norm)
    }
    return [v, lambda] as const
  }
  const [v1, l1] = power()
  const [v2, l2] = power(v1)
  return [v1, v2, l1, l2]
}

/**
 * Cluster centres via classical MDS on centroid cosine distances, then each
 * ticket in a phyllotaxis disc around its centre: typical tickets in the
 * middle, outliers on the rim. Returns positions in [0,1]² and per-cluster centre/radius.
 */
export function layout2d(X: Vec[], assign: ArrayLike<number>, centroids: Vec[]) {
  const k = centroids.length, n = X.length
  const sizes = new Array(k).fill(0)
  for (let i = 0; i < n; i++) sizes[assign[i]]++
  let cx: number[], cy: number[]
  if (k < 3) { cx = centroids.map((_, i) => i); cy = centroids.map(() => 0) }
  else {
    const D2 = centroids.map(a => centroids.map(b => (1 - dot(a, b)) ** 2))
    const rowMean = D2.map(r => r.reduce((a, b) => a + b, 0) / k)
    const all = rowMean.reduce((a, b) => a + b, 0) / k
    const B = D2.map((r, i) => r.map((d, j) => -0.5 * (d - rowMean[i] - rowMean[j] + all)))
    const [v1, v2, l1, l2] = topEigen2(B)
    cx = v1.map(x => x * Math.sqrt(l1)); cy = v2.map(x => x * Math.sqrt(l2))
  }
  // Blend min-max position with rank so a couple of outlying clusters cannot squash the rest into a corner.
  const norm = (a: number[]) => {
    const lo = Math.min(...a), hi = Math.max(...a)
    const order = a.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0])
    const rank = new Array(a.length)
    order.forEach(([, i], r) => (rank[i] = a.length > 1 ? r / (a.length - 1) : 0.5))
    return a.map((x, i) => 0.45 * (hi - lo ? (x - lo) / (hi - lo) : 0.5) + 0.55 * rank[i])
  }
  cx = norm(cx).map(x => 0.12 + x * 0.76); cy = norm(cy).map(y => 0.14 + y * 0.72)
  const total = Math.max(1, n)
  const radius = sizes.map(s => 0.035 + 0.16 * Math.sqrt(s / total))
  // Push overlapping discs apart.
  for (let it = 0; it < 120; it++) {
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
      const dx = cx[b] - cx[a], dy = cy[b] - cy[a], dist = Math.hypot(dx, dy) || 1e-6
      const need = radius[a] + radius[b] + 0.018
      if (dist < need) {
        const push = (need - dist) / 2, ux = dx / dist || 1, uy = dy / dist
        cx[a] -= ux * push; cy[a] -= uy * push; cx[b] += ux * push; cy[b] += uy * push
      }
    }
    for (let a = 0; a < k; a++) { cx[a] = Math.min(1 - radius[a], Math.max(radius[a], cx[a])); cy[a] = Math.min(1 - radius[a], Math.max(radius[a], cy[a])) }
  }
  const x = new Float32Array(n), y = new Float32Array(n)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let c = 0; c < k; c++) {
    const members: number[] = []
    for (let i = 0; i < n; i++) if (assign[i] === c) members.push(i)
    const ranked = byTypicality(X, members, centroids[c])
    ranked.forEach((r, rank) => {
      const rr = radius[c] * Math.sqrt((rank + 0.5) / ranked.length)
      x[r.i] = cx[c] + rr * Math.cos(rank * golden)
      y[r.i] = cy[c] + rr * Math.sin(rank * golden)
    })
  }
  return { x, y, centers: cx.map((v, i) => ({ x: v, y: cy[i], r: radius[i] })) }
}
