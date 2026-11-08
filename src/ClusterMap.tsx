// Canvas cluster map: tickets as points in intent discs, coloured by tier.
// Points fly in from the left when they are "born", so the same component
// powers the live landing hero and the in-app map.

import { useEffect, useRef, useState } from 'react'
import type { Tier } from './engine/score.ts'
import { cssVar } from './ui.tsx'

export interface MapData {
  x: Float32Array
  y: Float32Array
  assign: Int32Array
  centers: { x: number; y: number; r: number }[]
  names: string[]
  tiers: Tier[]
}

interface Props {
  data: MapData
  /** Birth time (performance.now ms) per point; Infinity = not yet visible. Mutated in place by the hero. */
  born?: Float64Array
  live?: boolean
  selected?: number | null
  onSelect?: (cluster: number | null) => void
  tooltip?: (i: number) => string
  labelMin?: number
  pointSize?: number
  /** Where unborn points fly in from, in canvas fraction. */
  origin?: { x: number; y: number }
}

const FLY = 1100
const ease = (t: number) => 1 - Math.pow(1 - t, 4)

export function ClusterMap({ data, born, live, selected = null, onSelect, tooltip, labelMin = 0.03, pointSize = 2.4, origin = { x: -0.05, y: 0.5 } }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string; name: string } | null>(null)
  const hover = useRef<number | null>(null)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    let raf = 0, colors: Record<string, string> = {}, w = 0, h = 0
    const readColors = () => {
      colors = { automatable: cssVar('--tier-auto'), action: cssVar('--tier-action'), human: cssVar('--tier-human'), ink: cssVar('--ink-1'), ink3: cssVar('--ink-3'), line: cssVar('--line'), surface: cssVar('--surface-3'), font: cssVar('--font') }
    }
    const resize = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1)
      w = r.width; h = r.height
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    readColors(); resize()
    const ro = new ResizeObserver(() => { resize(); draw(performance.now()) })
    ro.observe(cv)
    const mo = new MutationObserver(() => { readColors(); draw(performance.now()) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })

    const pad = 18
    const sx = (v: number) => pad + v * (w - pad * 2)
    const sy = (v: number) => pad + 26 + v * (h - pad * 2 - 56)
    const scale = () => Math.min(w - pad * 2, h - pad * 2 - 56)

    function draw(now: number) {
      ctx.clearRect(0, 0, w, h)
      if (w < 60 || h < 80) return false
      const { x, y, assign, centers, names, tiers } = data
      const k = centers.length
      const counts = new Array(k).fill(0)
      let animating = false
      // Halos
      for (let i = 0; i < x.length; i++) if (!born || born[i] <= now) counts[assign[i]]++
      centers.forEach((c, j) => {
        if (!counts[j] || assign.length === 0) return
        const R = Math.max(1, c.r * scale() * 1.25)
        const g = ctx.createRadialGradient(sx(c.x), sy(c.y), 0, sx(c.x), sy(c.y), R)
        const col = colors[tiers[j]] || colors.ink3
        const a = selected === j ? 0.22 : selected == null ? 0.1 : 0.04
        g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0))
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(sx(c.x), sy(c.y), R, 0, Math.PI * 2); ctx.fill()
      })
      // Points
      for (let i = 0; i < x.length; i++) {
        const b = born ? born[i] : 0
        if (b > now) continue
        const c = assign[i]
        const t = reduced ? 1 : Math.min(1, (now - b) / FLY)
        if (t < 1) animating = true
        const e = ease(t)
        const tx = sx(x[i]), ty = sy(y[i])
        const ox = sx(origin.x), oy = sy(origin.y) + (((i * 7919) % 100) - 50) * 0.6
        // Curved flight path
        const mx = (ox + tx) / 2, my = Math.min(oy, ty) - 60
        const px = (1 - e) * (1 - e) * ox + 2 * (1 - e) * e * mx + e * e * tx
        const py = (1 - e) * (1 - e) * oy + 2 * (1 - e) * e * my + e * e * ty
        const dim = selected != null && selected !== c
        ctx.globalAlpha = dim ? 0.18 : t < 1 ? 0.5 + 0.5 * e : 0.88
        ctx.fillStyle = colors[tiers[c]] || colors.ink3
        const s = pointSize * (t < 1 ? 1.6 - 0.6 * e : 1) * (hover.current === i ? 2 : 1)
        ctx.beginPath(); ctx.arc(px, py, s, 0, Math.PI * 2); ctx.fill()
        if (t < 1 && t > 0.05) { ctx.globalAlpha = 0.25 * (1 - e); ctx.beginPath(); ctx.arc(px, py, s * 3.5, 0, Math.PI * 2); ctx.fill() }
      }
      ctx.globalAlpha = 1
      // Labels
      ctx.font = `500 12px ${colors.font || 'sans-serif'}`
      ctx.textBaseline = 'middle'
      const total = counts.reduce((a, b) => a + b, 0) || 1
      const placed: { x: number; y: number; w: number }[] = []
      const order = centers.map((_, j) => j).sort((a, b) => counts[b] - counts[a])
      for (const j of order) {
        if (!counts[j] || (counts[j] / total < labelMin && selected !== j)) continue
        const c = centers[j]
        const label = trunc(names[j], 26)
        const tw = ctx.measureText(label).width + 20
        const lx = Math.max(4, Math.min(w - tw - 4, sx(c.x) - tw / 2)), ly = sy(c.y) - c.r * scale() - 14
        if (placed.some(p => Math.abs(p.x - lx) < (p.w + tw) / 2 + 4 && Math.abs(p.y - ly) < 24)) continue
        placed.push({ x: lx, y: ly, w: tw })
        ctx.globalAlpha = selected != null && selected !== j ? 0.35 : 1
        ctx.fillStyle = colors.surface
        roundRect(ctx, lx, ly - 11, tw, 22, 11); ctx.fill()
        ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.stroke()
        ctx.fillStyle = colors[tiers[j]]
        ctx.beginPath(); ctx.arc(lx + 10, ly, 3, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = colors.ink
        ctx.fillText(label, lx + 17, ly + 0.5)
      }
      ctx.globalAlpha = 1
      return animating
    }

    const loop = (now: number) => {
      const animating = draw(now)
      if (live || animating) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const nearest = (ev: PointerEvent) => {
      const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top
      let best = -1, bd = 100
      const now = performance.now()
      for (let i = 0; i < data.x.length; i++) {
        if (born && born[i] > now) continue
        const d = (sx(data.x[i]) - mx) ** 2 + (sy(data.y[i]) - my) ** 2
        if (d < bd) { bd = d; best = i }
      }
      let cl: number | null = best >= 0 ? data.assign[best] : null
      if (cl == null) {
        data.centers.forEach((c, j) => { if (Math.hypot(sx(c.x) - mx, sy(c.y) - my) < c.r * scale()) cl = j })
      }
      return { best, cl, mx, my }
    }
    const onMove = (ev: PointerEvent) => {
      if (!tooltip && !onSelect) return
      const { best, cl, mx, my } = nearest(ev)
      hover.current = best >= 0 ? best : null
      cv.style.cursor = cl != null && onSelect ? 'pointer' : 'default'
      if (tooltip && best >= 0) setTip({ x: mx, y: my, text: tooltip(best), name: data.names[data.assign[best]] })
      else setTip(null)
      if (!live) draw(performance.now())
    }
    const onLeave = () => { hover.current = null; setTip(null); if (!live) draw(performance.now()) }
    const onClick = (ev: PointerEvent) => { if (onSelect) { const { cl } = nearest(ev); onSelect(cl === selected ? null : cl) } }
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerleave', onLeave)
    cv.addEventListener('click', onClick as (e: Event) => void)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('click', onClick as (e: Event) => void) }
  }, [data, born, live, selected, onSelect, tooltip, labelMin, pointSize, origin, reduced])

  return (
    <>
      <canvas ref={ref} role="img" aria-label={`Cluster map of ${data.x.length} tickets in ${data.centers.length} intents`} />
      {tip && (
        <div className="maptip" style={{ left: Math.min(tip.x + 14, (ref.current?.clientWidth ?? 400) - 290), top: tip.y + 14 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{tip.name}</div>
          {tip.text}
        </div>
      )}
    </>
  )
}

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
function hexA(col: string, a: number) {
  const m = col.match(/^#([0-9a-f]{6})$/i)
  if (!m) return col
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
