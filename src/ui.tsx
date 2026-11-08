// Shared UI: router, icons, modal, formatting, download helpers.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type MouseEvent } from 'react'
import { dismiss, toast, useToasts } from './lib/store.ts'
import { TIER_LABEL, type Tier } from './engine/score.ts'

// ---------- router ----------

const rsubs = new Set<() => void>()
window.addEventListener('popstate', () => rsubs.forEach(f => f()))
export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search + location.hash) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  rsubs.forEach(f => f())
  if (!to.includes('#')) window.scrollTo({ top: 0 })
}
export function usePath(): string {
  return useSyncExternalStore(f => (rsubs.add(f), () => rsubs.delete(f)), () => location.pathname)
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Record<string, unknown>) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  const current = typeof window !== 'undefined' && location.pathname === to ? 'page' : undefined
  return <a href={to} onClick={onClick} className={className} aria-current={current} {...rest}>{children}</a>
}

// ---------- icons (inline, 1.5px strokes) ----------

const P: Record<string, ReactNode> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  print: <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />,
  cloud: <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8H7Z" />,
  doc: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  map: <><circle cx="7" cy="8" r="2.5" /><circle cx="16" cy="7" r="2" /><circle cx="15" cy="16" r="3" /><circle cx="6" cy="17" r="1.5" /></>,
  route: <><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  compare: <path d="M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5 9-10" />,
  merge: <path d="M6 4v5a5 5 0 0 0 5 5h7M14 10l4 4-4 4M6 20v-6" />,
  split: <path d="M12 20v-7M12 13 6 6M12 13l6-7M3 6h6M15 6h6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5ZM4 19a2 2 0 0 1 2-2h13" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />,
}
export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
}

// ---------- modal ----------

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="spread" style={{ marginBottom: 18 }}>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toasts() {
  const list = useToasts()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast ${t.kind ?? ''}`}>
          <span>{t.text}</span>
          {t.undo && <button className="btn sm" onClick={() => { t.undo!(); dismiss(t.id) }}>Undo</button>}
          <button className="icon-btn" style={{ width: 28, height: 28, border: 0 }} onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  )
}

export function TierBadge({ tier, overridden }: { tier: Tier; overridden?: boolean }) {
  return <span className={`tier ${tier}`}><span className="dot" style={{ background: 'currentColor' }} />{TIER_LABEL[tier]}{overridden ? ' ·  set by you' : ''}</span>
}

export function ScoreRing({ score, tier, size = 64 }: { score: number; tier: Tier; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r
  return (
    <div className="score-ring" style={{ width: size, height: size }} aria-label={`Automatability ${score} of 100`}>
      <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`var(--tier-${tier === 'automatable' ? 'auto' : tier})`} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .8s var(--ease)' }} /></svg>
      <b style={{ fontSize: size / 3.2 }}>{score}</b>
    </div>
  )
}

export const tierColor = (t: Tier) => `var(--tier-${t === 'automatable' ? 'auto' : t})`

// ---------- formatting ----------

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')
export const fmtMoney = (n: number, compact = true) => {
  const s = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (compact && a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (compact && a >= 1e4) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`
  return `${s}$${Math.round(a).toLocaleString('en-US')}`
}
export const fmtPct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
export const fmtPeriod = (a: number | null, b: number | null) => (a && b ? `${fmtDate(a)} – ${fmtDate(b)}` : 'Undated tickets')
export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return fmtDate(t)
}

// ---------- files ----------

export function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export async function copy(text: string, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast({ text: what, kind: 'ok' }) }
  catch { toast({ text: 'Clipboard is blocked in this browser', kind: 'error' }) }
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'report'

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [q])
  return m
}

/** Reads a CSS custom property (for canvas drawing that follows the theme). */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
