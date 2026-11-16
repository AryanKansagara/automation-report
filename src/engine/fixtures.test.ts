// Importer checks against files laid out like the real exports: column lists and field
// names follow the Zendesk, Freshdesk and Intercom documentation. Values are made up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sniff, normalizeCsv, normalizeJson, parseDate, parseTags, isDayFirst } from './formats.ts'
import { isNoise, scoreSignals, computeSignals } from './score.ts'
import type { Ticket } from './formats.ts'

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
function csv(f: string) {
  const s = sniff(fx(f))
  if (s.kind !== 'csv') throw new Error('expected csv')
  return { s, out: normalizeCsv(s.table, s.mapping, s.format) }
}

test('fixture: Zendesk ticket CSV export (40 documented columns, no description) imports by subject', () => {
  const { s, out } = csv('zendesk-ticket-export.csv')
  assert.equal(s.format, 'zendesk-csv')
  assert.equal(s.mapping.id, 'ID')
  assert.equal(s.mapping.handleMinutes, 'Full resolution time in minutes')
  assert.equal(out.report.issues.length, 0)
  const [a, b, c, d] = out.tickets
  assert.equal(out.tickets.length, 4)
  assert.equal(a.subject, 'Where is my order #48213?')
  assert.equal(a.body, '')
  assert.deepEqual(a.tags, ['shipping', 'where_is_my_order'])
  assert.equal(a.handleMinutes, 87)
  assert.equal(a.csat, 0.8)
  assert.equal(b.reopens, 1)
  assert.equal(b.escalated, true, 'two group stations means it changed teams')
  assert.equal(c.csat, null, '"Offered" is not a rating')
  assert.equal(d.solvedAt, null)
  assert.equal(new Date(a.createdAt!).getMinutes(), 14)
})

test('fixture: Freshdesk CSV with day-first dates, hh:mm:ss hours and multi-word tags', () => {
  const { s, out } = csv('freshdesk-tickets.csv')
  assert.equal(s.format, 'freshdesk-csv')
  const [a, b] = out.tickets
  const d = new Date(a.createdAt!)
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 2, 25, 9])
  const d2 = new Date(b.createdAt!)
  assert.deepEqual([d2.getMonth(), d2.getDate()], [3, 3], '03/04/2026 in a day-first file is 3 April, not 4 March')
  assert.equal(a.handleMinutes, 150, '02:30:00 hours is 150 minutes, not 9000')
  assert.equal(b.handleMinutes, 25 * 60 + 30)
  assert.deepEqual(a.tags, ['late delivery', 'shipping'])
  assert.equal(a.csat, 1)
  assert.equal(b.csat, 0.15)
  assert.match(a.body, /still hasn't arrived/)
  assert.doesNotMatch(a.body, /Sam|<div>/)
})

test('fixture: Zendesk tickets API with sideloaded metric_sets picks up the metrics per ticket', () => {
  const out = normalizeJson(fx('zendesk-tickets-api.json'))
  assert.equal(out.report.format, 'zendesk-json')
  const [a, b] = out.tickets
  assert.equal(a.handleMinutes, 120)
  assert.equal(a.replies, 1)
  assert.equal(a.solvedAt, Date.parse('2026-02-10T11:12:40Z'))
  assert.equal(a.csat, 0.8)
  assert.equal(a.channel, 'web')
  assert.match(a.body, /\[NAME\]/)
  assert.equal(b.csat, null)
})

test('fixture: Intercom conversation list with an empty source subject falls back to the title', () => {
  const out = normalizeJson(fx('intercom-conversation.json'))
  assert.equal(out.report.format, 'intercom-json')
  const [t] = out.tickets
  assert.equal(t.subject, 'Order arrived damaged')
  assert.match(t.body, /cracked screen/)
  assert.equal(t.handleMinutes, 60)
  assert.equal(t.csat, 0.75)
  assert.equal(t.escalated, true)
  assert.deepEqual(t.tags, ['damaged item'])
  assert.equal(t.agentReplies.length, 1)
})

test('formats: day-first detection only triggers on an unambiguous value', () => {
  assert.equal(isDayFirst(['03/04/2026 10:00', '01/02/2026']), false)
  assert.equal(isDayFirst(['03/04/2026 10:00', '25/03/2026 09:10']), true)
  assert.equal(new Date(parseDate('03/04/2026', true)!).getMonth(), 3)
  assert.equal(new Date(parseDate('03/04/2026')!).getMonth(), 2)
})

test('formats: tags split on commas when present, otherwise on spaces', () => {
  assert.deepEqual(parseTags('vip refund_request'), ['vip', 'refund_request'])
  assert.deepEqual(parseTags('late delivery, refund'), ['late delivery', 'refund'])
})

const tk = (subject: string, body: string): Ticket => ({ id: subject + body, subject, body, channel: 'email', createdAt: null, solvedAt: null, agentReplies: [], replies: null, reopens: null, csat: null, tags: [], escalated: false, handleMinutes: null })

test('score: spam and contentless messages are noise, short real requests are not', () => {
  assert.equal(isNoise(tk('Quick question', 'Boost your SEO ranking today!! Click here for a free audit')), true)
  assert.equal(isNoise(tk('Re: your request', 'Thanks!')), true)
  assert.equal(isNoise(tk('(no subject)', 'test')), true)
  assert.equal(isNoise(tk('Refund', '')), false, 'subject-only exports must not be treated as empty')
  assert.equal(isNoise(tk('Order', 'Where is my order?')), false)
  assert.equal(isNoise(tk('Gift card', 'My gift card balance is wrong')), false)
})

test('score: a cluster that is mostly noise is kept out of automation as human only', () => {
  const noise = Array.from({ length: 10 }, (_, i) => tk('Re: your request', i % 2 ? 'ok' : 'Thanks!'))
  const r = scoreSignals(computeSignals(noise, 0.9, 1, null))
  assert.equal(r.tier, 'human')
  assert.ok(r.factors.some(f => f.key === 'noise'))
  const real = Array.from({ length: 10 }, () => tk('Where is my order?', 'When will my parcel arrive? It shipped a week ago.'))
  assert.notEqual(scoreSignals(computeSignals(real, 0.9, 1, null)).tier, 'human')
})

test('roi: hand-checked payback and net for one intent with no ramp', async () => {
  const { project, DEFAULT_ROI } = await import('./roi.ts')
  // 100 tickets/mo, automatable, score 50: rate 0.7 × (0.6 + 0.8 × 0.5) = 0.7, so 70 resolved/mo.
  // Net per resolution $6 − $1 = $5, so $350/mo; $700 setup pays back in exactly 2 months.
  const it = { id: 'i0', tier: 'automatable', score: 50, size: 100 } as any
  const s = { intents: [it], total: 100, months: 1 } as any
  const p = project(s, { ...DEFAULT_ROI, rampMonths: 0, horizonMonths: 12, setupCost: 700 }, 'base')
  assert.ok(Math.abs(p.fullRamp.resolved - 70) < 1e-9)
  assert.ok(Math.abs(p.fullRamp.net - 350) < 1e-9)
  assert.ok(Math.abs(p.paybackMonth! - 2) < 1e-9)
  assert.ok(Math.abs(p.totalNet - 350 * 12) < 1e-9, 'totalNet is before setup; the UI subtracts setup once')
  assert.ok(Math.abs(p.fullRamp.hours - 70 * 9 / 60) < 1e-9)
})
