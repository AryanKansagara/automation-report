// Detects the helpdesk export format, proposes a column mapping, and normalizes
// rows into one Ticket shape. Redaction happens here, before anything else.

import { parseCsv, type CsvTable } from './csv.ts'
import { cleanMessage } from './clean.ts'
import { redact, countKinds, type RedactOptions, type PiiKind } from './redact.ts'

export interface Ticket {
  id: string
  subject: string
  body: string
  channel: string
  createdAt: number | null
  solvedAt: number | null
  agentReplies: string[]
  replies: number | null
  reopens: number | null
  csat: number | null
  tags: string[]
  escalated: boolean
  handleMinutes: number | null
}

export type Field = 'id' | 'subject' | 'body' | 'channel' | 'createdAt' | 'solvedAt' | 'agentReplies' | 'replies' | 'reopens' | 'csat' | 'tags' | 'escalated' | 'handleMinutes' | 'groupStations'
export type FormatId = 'zendesk-csv' | 'zendesk-json' | 'intercom-csv' | 'intercom-json' | 'freshdesk-csv' | 'generic-csv'
export type Mapping = Partial<Record<Field, string>>

export const FIELD_LABELS: Record<Field, string> = {
  id: 'Ticket ID', subject: 'Subject', body: 'Body / first message', channel: 'Channel', createdAt: 'Created at', solvedAt: 'Solved / closed at',
  agentReplies: 'Agent reply text', replies: 'Reply count', reopens: 'Reopens', csat: 'CSAT / rating', tags: 'Tags', escalated: 'Escalated / handoff flag',
  handleMinutes: 'Resolution or handle time', groupStations: 'Group or team hops',
}

export const FORMAT_LABELS: Record<FormatId, string> = {
  'zendesk-csv': 'Zendesk CSV export', 'zendesk-json': 'Zendesk JSON export', 'intercom-csv': 'Intercom conversations CSV',
  'intercom-json': 'Intercom conversations JSON (API)', 'freshdesk-csv': 'Freshdesk tickets CSV', 'generic-csv': 'Generic CSV',
}

// Column names as they appear in real exports, most specific first.
const CANDIDATES: Record<Field, string[]> = {
  id: ['Id', 'ID', 'Ticket ID', 'Conversation ID', 'ticket_id', 'id'],
  subject: ['Subject', 'Conversation title', 'Title', 'subject', 'title'],
  body: ['Description', 'Conversation first message', 'First message', 'Initial message', 'Body', 'Message', 'Customer message', 'body', 'description', 'message', 'text'],
  channel: ['Via', 'Source', 'Channel', 'Conversation source', 'Source type', 'channel', 'via'],
  createdAt: ['Created at', 'Created time', 'Conversation created at', 'Conversation started at', 'Started at', 'created_at', 'created'],
  solvedAt: ['Solved at', 'Resolved time', 'Closed time', 'Last closed at', 'Conversation last closed at', 'solved_at', 'closed_at', 'resolved_at'],
  agentReplies: ['Agent reply', 'Agent replies', 'Agent response', 'First agent reply', 'agent_reply', 'agent_replies', 'Resolution notes'],
  replies: ['Replies', 'Agent interactions', 'Teammate replies', 'Number of teammate replies', 'replies'],
  reopens: ['Reopens', 'Number of reopens', 'Reopened count', 'reopens', 'reopened'],
  csat: ['Satisfaction Score', 'Survey results', 'Conversation rating', 'CSAT', 'Rating', 'csat', 'satisfaction'],
  tags: ['Tags', 'Conversation tags', 'tags', 'labels'],
  escalated: ['Escalated', 'Handed off', 'Handoff', 'Fin AI Agent escalated', 'escalated', 'handoff'],
  handleMinutes: ['Full resolution time in minutes', 'Resolution time (in hrs)', 'Time to close', 'Handle time', 'Time tracked', 'handle_minutes', 'resolution_minutes'],
  groupStations: ['Group stations', 'Assignee stations', 'Team reassignments'],
}

export function detectCsvFormat(header: string[]): FormatId {
  const h = new Set(header.map(x => x.toLowerCase()))
  const has = (...xs: string[]) => xs.every(x => h.has(x.toLowerCase()))
  if (has('Summation column') || has('Requester id', 'Via') || has('Satisfaction Score', 'Group stations')) return 'zendesk-csv'
  if (has('Conversation ID') || [...h].some(x => x.startsWith('conversation ') && h.has('conversation id'))) return 'intercom-csv'
  if (has('Ticket ID', 'Resolved time') || has('Ticket ID', 'Agent interactions') || has('Ticket ID', 'Survey results')) return 'freshdesk-csv'
  return 'generic-csv'
}

export function suggestMapping(header: string[]): Mapping {
  const lower = new Map(header.map(h => [h.toLowerCase(), h]))
  const m: Mapping = {}
  for (const f of Object.keys(CANDIDATES) as Field[]) {
    for (const c of CANDIDATES[f]) {
      const hit = lower.get(c.toLowerCase())
      if (hit) { m[f] = hit; break }
    }
  }
  return m
}

// ---------- value parsers ----------

export function parseDate(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v
  const s = String(v).trim()
  if (/^\d{9,10}$/.test(s)) return +s * 1000
  if (/^\d{12,13}$/.test(s)) return +s
  let iso = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2').replace(/ ?([+-]\d{2}):?(\d{2})$/, '$1:$2').replace(/ UTC$/, 'Z')
  let t = Date.parse(iso)
  if (Number.isNaN(t)) {
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i)
    if (m) {
      let hh = +(m[4] ?? 0)
      if (m[7]) hh = (hh % 12) + (/pm/i.test(m[7]) ? 12 : 0)
      t = new Date(+m[3], +m[1] - 1, +m[2], hh, +(m[5] ?? 0), +(m[6] ?? 0)).getTime()
    }
  }
  return Number.isNaN(t) ? null : t
}

const CSAT_WORDS: [RegExp, number][] = [
  [/^(extremely happy|amazing|very satisfied|excellent)$/i, 1], [/^(good|happy|great|satisfied|positive|yes)$/i, 0.8],
  [/^(neutral|ok|okay)$/i, 0.5], [/^(bad|unhappy|unsatisfied|dissatisfied|negative|no)$/i, 0.15], [/^(extremely unhappy|terrible|very dissatisfied|awful)$/i, 0],
]

/** CSAT to 0..1, or null when not rated (Zendesk "Offered"/"Unoffered" etc). */
export function parseCsat(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'object') v = (v as { score?: unknown; rating?: unknown }).score ?? (v as { rating?: unknown }).rating
  const s = String(v).trim()
  if (/^\d+(\.\d+)?$/.test(s)) { const n = +s; return n <= 1 ? n : n <= 5 ? (n - 1) / 4 : n <= 10 ? n / 10 : n / 100 }
  for (const [re, x] of CSAT_WORDS) if (re.test(s)) return x
  return null
}

export function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).trim()
  const hms = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/)
  if (hms) return +hms[1] * 60 + +hms[2] + (hms[3] ? +hms[3] / 60 : 0)
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(t => (typeof t === 'string' ? t : (t as { name?: string }).name ?? '')).filter(Boolean)
  if (v && typeof v === 'object' && Array.isArray((v as { tags?: unknown[] }).tags)) return parseTags((v as { tags: unknown[] }).tags)
  return String(v ?? '').split(/[,;|]|\s(?=\S)/).map(t => t.trim()).filter(Boolean)
}

const ESC_TAG = /escalat|tier[ _-]?2|tier[ _-]?3|manager|supervisor|handoff|hand[ _-]?over|transfer|complaint/i
const truthy = (v: unknown) => /^(true|yes|y|1|escalated)$/i.test(String(v ?? '').trim())

// ---------- normalize ----------

export interface ValidationReport {
  format: FormatId
  total: number
  imported: number
  issues: { line: number; message: string }[]
  pii: Partial<Record<PiiKind, number>>
  coverage: Partial<Record<Field, number>>
  /** A few before/after pairs for the redaction preview. */
  samples: { before: string; after: string; cleaned: string; spans: { start: number; end: number; kind: PiiKind }[] }[]
}

export interface RawRecord { line: number; get: (f: Field) => unknown }

function normalizeRecords(records: RawRecord[], format: FormatId, opts: RedactOptions, hoursField: boolean): { tickets: Ticket[]; report: ValidationReport } {
  const report: ValidationReport = { format, total: records.length, imported: 0, issues: [], pii: {}, coverage: {}, samples: [] }
  const tickets: Ticket[] = []
  const seen = new Set<string>()
  const scrub = (s: string) => {
    const r = redact(s, opts)
    countKinds(r.spans, report.pii)
    if (r.spans.length && report.samples.length < 6 && s.length < 600) report.samples.push({ before: s, after: r.text, cleaned: cleanMessage(r.text), spans: r.spans })
    return cleanMessage(r.text)
  }
  for (const rec of records) {
    const rawSubject = String(rec.get('subject') ?? '')
    const rawBody = String(rec.get('body') ?? '')
    if (!rawSubject.trim() && !rawBody.trim()) { report.issues.push({ line: rec.line, message: 'No subject or message text; row skipped' }); continue }
    let id = String(rec.get('id') ?? '').trim() || `row-${rec.line}`
    if (seen.has(id)) { report.issues.push({ line: rec.line, message: `Duplicate ticket id ${id}; kept the first` }); continue }
    seen.add(id)
    const createdRaw = rec.get('createdAt')
    const createdAt = parseDate(createdRaw)
    if (createdRaw && createdAt == null) report.issues.push({ line: rec.line, message: `Unreadable created date "${String(createdRaw).slice(0, 40)}"` })
    const solvedAt = parseDate(rec.get('solvedAt'))
    const tags = parseTags(rec.get('tags')).map(t => t.toLowerCase())
    const replyRaw = rec.get('agentReplies')
    const agentReplies = (Array.isArray(replyRaw) ? replyRaw : replyRaw ? [replyRaw] : []).map(r => scrub(String(r))).filter(Boolean)
    let handle = parseNum(rec.get('handleMinutes'))
    if (handle != null && hoursField) handle *= 60
    if (handle == null && createdAt != null && solvedAt != null && solvedAt > createdAt) handle = (solvedAt - createdAt) / 60000
    const stations = parseNum(rec.get('groupStations'))
    const escRaw = rec.get('escalated')
    const t: Ticket = {
      id,
      subject: scrub(rawSubject),
      body: scrub(rawBody),
      channel: String(rec.get('channel') ?? '').toLowerCase().trim() || 'unknown',
      createdAt, solvedAt, agentReplies,
      replies: parseNum(rec.get('replies')),
      reopens: parseNum(rec.get('reopens')),
      csat: parseCsat(rec.get('csat')),
      tags,
      escalated: truthy(escRaw) || tags.some(t => ESC_TAG.test(t)) || (stations != null && stations > 1),
      handleMinutes: handle,
    }
    for (const f of Object.keys(FIELD_LABELS) as Field[]) {
      const v = rec.get(f)
      if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) report.coverage[f] = (report.coverage[f] ?? 0) + 1
    }
    tickets.push(t)
  }
  report.imported = tickets.length
  return { tickets, report }
}

export function normalizeCsv(table: CsvTable, mapping: Mapping, format: FormatId, opts: RedactOptions = {}) {
  const idx = Object.fromEntries(Object.entries(mapping).map(([f, col]) => [f, table.header.indexOf(col!)])) as Partial<Record<Field, number>>
  const records: RawRecord[] = table.rows.map((row, i) => ({ line: table.lines[i], get: f => (idx[f] != null && idx[f]! >= 0 ? row[idx[f]!] : undefined) }))
  const hours = /hrs|hours/i.test(mapping.handleMinutes ?? '')
  const out = normalizeRecords(records, format, opts, hours)
  out.report.issues.unshift(...table.issues)
  return out
}

// ---------- JSON exports (Zendesk NDJSON, Intercom API) ----------

type Obj = Record<string, any>

export function parseJsonRecords(text: string): { records: Obj[]; issues: { line: number; message: string }[] } {
  const issues: { line: number; message: string }[] = []
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.includes('\n{'))) {
    try {
      const j = JSON.parse(trimmed)
      const arr = Array.isArray(j) ? j : j.tickets ?? j.conversations ?? j.data ?? [j]
      return { records: arr.map((r: Obj) => r.ticket ?? r), issues }
    } catch { /* fall through to NDJSON */ }
  }
  const records: Obj[] = []
  text.split('\n').forEach((l, i) => {
    if (!l.trim()) return
    try { const r = JSON.parse(l); records.push(r.ticket ?? r) } catch { issues.push({ line: i + 1, message: 'Line is not valid JSON' }) }
  })
  return { records, issues }
}

export function detectJsonFormat(r: Obj | undefined): FormatId {
  if (r && ('source' in r || 'conversation_parts' in r || r.type === 'conversation')) return 'intercom-json'
  return 'zendesk-json'
}

function zendeskGet(r: Obj): RawRecord['get'] {
  const comments: Obj[] = Array.isArray(r.comments) ? r.comments : []
  const agentComments = comments.filter(c => c.public !== false && c.author_id != null && c.author_id !== r.requester_id).map(c => c.plain_body ?? c.body ?? '')
  return f => {
    switch (f) {
      case 'id': return r.id
      case 'subject': return r.subject ?? r.raw_subject
      case 'body': return r.description ?? comments[0]?.plain_body ?? comments[0]?.body
      case 'channel': return r.via?.channel ?? r.via
      case 'createdAt': return r.created_at
      case 'solvedAt': return r.metric_set?.solved_at ?? r.solved_at
      case 'agentReplies': return agentComments.slice(0, 3)
      case 'replies': return r.metric_set?.replies ?? (comments.length ? agentComments.length : undefined)
      case 'reopens': return r.metric_set?.reopens
      case 'csat': return r.satisfaction_rating
      case 'tags': return r.tags
      case 'escalated': return undefined
      case 'handleMinutes': return r.metric_set?.full_resolution_time_in_minutes?.calendar
      case 'groupStations': return r.metric_set?.group_stations
    }
  }
}

function intercomGet(r: Obj): RawRecord['get'] {
  const parts: Obj[] = r.conversation_parts?.conversation_parts ?? []
  const adminReplies = parts.filter(p => p.author?.type === 'admin' && p.part_type === 'comment' && p.body).map(p => p.body)
  const handedOff = r.ai_agent_participated && r.ai_agent?.resolution_state && /routed|escalat|handoff/i.test(r.ai_agent.resolution_state)
  return f => {
    switch (f) {
      case 'id': return r.id
      case 'subject': return r.source?.subject ?? r.title
      case 'body': return r.source?.body
      case 'channel': return r.source?.type ?? r.source?.delivered_as
      case 'createdAt': return r.created_at
      case 'solvedAt': return r.statistics?.last_close_at
      case 'agentReplies': return adminReplies.slice(0, 3)
      case 'replies': return r.statistics?.count_conversation_parts != null ? adminReplies.length : undefined
      case 'reopens': return r.statistics?.count_reopens
      case 'csat': return r.conversation_rating?.rating
      case 'tags': return r.tags
      case 'escalated': return handedOff ? 'true' : undefined
      case 'handleMinutes': return r.statistics?.time_to_last_close != null ? r.statistics.time_to_last_close / 60 : undefined
      case 'groupStations': return undefined
    }
  }
}

export function normalizeJson(text: string, opts: RedactOptions = {}) {
  const { records, issues } = parseJsonRecords(text)
  const format = detectJsonFormat(records[0])
  const get = format === 'intercom-json' ? intercomGet : zendeskGet
  const out = normalizeRecords(records.map((r, i) => ({ line: i + 1, get: get(r) })), format, opts, false)
  out.report.issues.unshift(...issues)
  return out
}

/** One entry point for the importer: sniff JSON vs CSV, detect format, propose mapping. */
export function sniff(text: string): { kind: 'json' } | { kind: 'csv'; table: CsvTable; format: FormatId; mapping: Mapping } {
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) return { kind: 'json' }
  const table = parseCsv(text)
  return { kind: 'csv', table, format: detectCsvFormat(table.header), mapping: suggestMapping(table.header) }
}
