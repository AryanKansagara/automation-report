import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCsv, toCsv, detectDelimiter } from './csv.ts'
import { redact, findPii } from './redact.ts'
import { cleanMessage, stripHtml } from './clean.ts'
import { sniff, normalizeCsv, normalizeJson, parseDate, parseCsat, parseNum, detectCsvFormat, suggestMapping } from './formats.ts'
import { lexicalEmbed, ticketText } from './lexical.ts'
import { kmeans, silhouette, chooseK, cTfidf, nameFromSubjects, layout2d } from './cluster.ts'
import { analyze, mergeIntents, splitIntent, effectiveTier, type Snapshot } from './analyze.ts'
import { scoreSignals, computeSignals, negativity, detectActions } from './score.ts'
import { project, ramp, DEFAULT_ROI, intentRate } from './roi.ts'
import { parseArticles, matchArticles, helpCenterUrl, articleText } from './kb.ts'
import { roadmap, catalogue, catalogueCsv, compareSnapshots } from './outputs.ts'
import { sampleNdjson, sampleFreshdeskCsv, SAMPLE_ARTICLES, generateSample } from './sample.ts'
import { parseCache } from './embcache.ts'
import { textKey, quantize, dequantize, dot, normalize } from './util.ts'

const SRC = { format: 'test', fileName: 't', total: 0, imported: 0, pii: {} }

// ---------- CSV ----------

test('csv: quoted fields, escaped quotes and multi-line cells keep source line numbers', () => {
  const t = parseCsv('id,body\n1,"hello, ""world"""\n2,"line one\nline two"\n3,plain\n')
  assert.deepEqual(t.header, ['id', 'body'])
  assert.equal(t.rows[0][1], 'hello, "world"')
  assert.equal(t.rows[1][1], 'line one\nline two')
  assert.deepEqual(t.lines, [2, 3, 5])
})

test('csv: reports ragged rows with the line they start on, and round-trips through toCsv', () => {
  const t = parseCsv('a,b\n1,2\n3\n')
  assert.equal(t.issues.length, 1)
  assert.equal(t.issues[0].line, 3)
  const back = parseCsv(toCsv(['x', 'y'], [['a,b', 'q"t'], ['multi\nline', 2]]))
  assert.deepEqual(back.rows, [['a,b', 'q"t'], ['multi\nline', '2']])
})

test('csv: detects semicolon and tab delimiters', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n'), ';')
  assert.equal(detectDelimiter('a\tb\n1\t2\n'), '\t')
})

// ---------- redaction ----------

test('redact: emails, phones, Luhn-valid cards and addresses become tokens', () => {
  const r = redact('Email jane.doe+x@gmail.com or call (416) 555-0199. Card 4111 1111 1111 1111. Ship to 221 Maple Avenue, Toronto ON M5V 2T6.')
  assert.match(r.text, /\[EMAIL\]/)
  assert.match(r.text, /\[PHONE\]/)
  assert.match(r.text, /\[CARD\]/)
  assert.match(r.text, /\[ADDRESS\]/)
  assert.doesNotMatch(r.text, /jane|0199|4111|Maple|M5V/)
})

test('redact: order numbers and non-Luhn digit runs are left alone', () => {
  const r = redact('Order #4815162342 and reference 1234 5678 9012 3456 shipped.')
  assert.equal(r.spans.length, 0)
  assert.equal(findPii('My order 663433 is late').length, 0)
})

test('redact: options can disable address redaction; names after "my name is" are caught', () => {
  assert.equal(redact('Ship to 10 King Street please', { addresses: false }).spans.length, 0)
  assert.equal(redact('Hi, my name is Priya Patel and I need help').text, 'Hi, my name is [NAME] and I need help')
})

// ---------- cleaning ----------

test('clean: removes quoted replies, signatures, greetings and mobile footers', () => {
  const raw = 'Hi team,\nMy jacket arrived torn.\nCan I get a replacement?\n\nThanks,\nMaya\n\nSent from my iPhone\n\nOn Mon, Sep 8, 2026 at 9:14 AM Support <x@y.z> wrote:\n> We got your request'
  assert.equal(cleanMessage(raw), 'My jacket arrived torn.\nCan I get a replacement?')
})

test('clean: strips HTML and legal disclaimers', () => {
  assert.equal(stripHtml('<p>Hello &amp; welcome<br>there</p>').trim(), 'Hello & welcome\nthere')
  assert.equal(cleanMessage('Where is my order?\n\nThis email and any attachments are confidential and intended solely for the addressee.'), 'Where is my order?')
})

// ---------- formats ----------

test('formats: detects Zendesk, Freshdesk and Intercom CSV headers and maps their columns', () => {
  const zd = ['Summation column', 'Id', 'Requester', 'Subject', 'Via', 'Created at', 'Solved at', 'Satisfaction Score', 'Reopens', 'Replies', 'Full resolution time in minutes', 'Tags', 'Group stations']
  assert.equal(detectCsvFormat(zd), 'zendesk-csv')
  const m = suggestMapping(zd)
  assert.equal(m.id, 'Id'); assert.equal(m.handleMinutes, 'Full resolution time in minutes'); assert.equal(m.groupStations, 'Group stations')
  assert.equal(detectCsvFormat(['Ticket ID', 'Subject', 'Description', 'Resolved time', 'Agent interactions']), 'freshdesk-csv')
  assert.equal(detectCsvFormat(['Conversation ID', 'Conversation started at', 'Conversation tags', 'Conversation rating']), 'intercom-csv')
  assert.equal(detectCsvFormat(['ticket', 'text']), 'generic-csv')
})

test('formats: parses the date, rating and duration shapes real exports use', () => {
  assert.equal(parseDate('2026-09-03 14:22:10'), Date.parse('2026-09-03T14:22:10'))
  assert.equal(parseDate('2026-09-03T14:22:10Z'), Date.UTC(2026, 8, 3, 14, 22, 10))
  assert.equal(parseDate(1788000000), 1788000000000)
  assert.equal(parseDate('09/03/2026 2:22 PM'), new Date(2026, 8, 3, 14, 22, 0).getTime())
  assert.equal(parseDate('not a date'), null)
  assert.equal(parseCsat('Good'), 0.8)
  assert.equal(parseCsat('Unoffered'), null)
  assert.equal(parseCsat('Extremely Happy'), 1)
  assert.equal(parseCsat('5'), 1)
  assert.equal(parseNum('1:30'), 90)
  assert.equal(parseNum('1,250'), 1250)
})

test('formats: Freshdesk CSV normalizes with hours converted to minutes, PII redacted, and a validation report', () => {
  const text = sampleFreshdeskCsv(0) + '999999,,,Closed\n'
  const s = sniff(text)
  assert.equal(s.kind, 'csv')
  if (s.kind !== 'csv') return
  assert.equal(s.format, 'freshdesk-csv')
  const { tickets, report } = normalizeCsv(s.table, s.mapping, s.format)
  assert.equal(report.imported, 1400)
  assert.ok(report.issues.some(i => /columns/.test(i.message)))
  assert.ok((report.pii.email ?? 0) > 50)
  assert.ok(tickets.every(t => !/@gmail\.com/.test(t.body)))
  const t = tickets.find(t => t.handleMinutes != null)!
  assert.ok(t.handleMinutes! > 0)
  assert.ok(tickets.some(t => t.escalated))
})

test('formats: Zendesk JSON (NDJSON) yields agent replies, CSAT, reopens and escalation from metrics', () => {
  const { tickets, report } = normalizeJson(sampleNdjson(0))
  assert.equal(report.format, 'zendesk-json')
  assert.equal(tickets.length, 1400)
  const withReply = tickets.filter(t => t.agentReplies.length)
  assert.ok(withReply.length > 1200)
  assert.ok(!withReply[0].agentReplies[0].startsWith('Hi '), 'greeting stripped from agent reply')
  assert.ok(tickets.some(t => t.csat === 0.8) && tickets.some(t => t.csat === null))
  assert.ok(tickets.some(t => (t.reopens ?? 0) > 0))
})

test('formats: Intercom API JSON maps source body, parts and Fin handoff', () => {
  const conv = { type: 'conversation', id: '42', created_at: 1788000000, source: { subject: '', body: '<p>How do I reset my password?</p>', type: 'conversation' }, tags: { tags: [{ name: 'login' }] }, conversation_rating: { rating: 2 }, statistics: { count_reopens: 1, last_close_at: 1788003600 }, ai_agent_participated: true, ai_agent: { resolution_state: 'routed_to_team' }, conversation_parts: { conversation_parts: [{ part_type: 'comment', author: { type: 'admin' }, body: 'I sent you a reset link.' }] } }
  const { tickets, report } = normalizeJson(JSON.stringify({ conversations: [conv] }))
  assert.equal(report.format, 'intercom-json')
  const t = tickets[0]
  assert.equal(t.body, 'How do I reset my password?')
  assert.deepEqual(t.tags, ['login'])
  assert.equal(t.escalated, true)
  assert.equal(t.reopens, 1)
  assert.equal(t.csat, 0.25)
  assert.equal(Math.round(t.handleMinutes!), 60)
})

test('formats: rows without text and duplicate ids are skipped with line numbers', () => {
  const s = sniff('Ticket ID,Subject,Description\n1,Hello,where is my order\n1,Dup,again\n2,,\n')
  if (s.kind !== 'csv') throw new Error('expected csv')
  const { report } = normalizeCsv(s.table, s.mapping, s.format)
  assert.equal(report.imported, 1)
  assert.deepEqual(report.issues.map(i => i.line), [3, 4])
})

// ---------- clustering ----------

const blobs = (() => {
  const texts: string[] = []
  const groups = [
    ['where is my order tracking', 'my package has not arrived tracking', 'order tracking not updating where is it', 'when will my package arrive tracking'],
    ['reset my password login', 'cannot login password reset link', 'locked out login password', 'password reset email login missing'],
    ['refund for my return', 'refund not received for return', 'when will my refund arrive return', 'refund status return processed'],
  ]
  for (let r = 0; r < 12; r++) for (const g of groups) texts.push(g[r % 4] + ` ${['please', 'thanks', 'urgent', 'hello'][r % 4]}`)
  return texts
})()

test('cluster: seeded k-means recovers well separated groups and is deterministic', () => {
  const X = blobs.map(lexicalEmbed)
  const a = kmeans(X, 3, 7), b = kmeans(X, 3, 7)
  assert.deepEqual(Array.from(a.assign), Array.from(b.assign))
  for (let g = 0; g < 3; g++) {
    const labels = new Set(X.map((_, i) => a.assign[i]).filter((_, i) => i % 3 === g))
    assert.equal(labels.size, 1, `group ${g} should land in one cluster`)
  }
  assert.ok(silhouette(X, a.assign, X.map((_, i) => i)) > 0.2)
})

test('cluster: silhouette prefers the true k over a bad split', () => {
  const X = blobs.map(lexicalEmbed)
  const all = X.map((_, i) => i)
  const s3 = silhouette(X, kmeans(X, 3, 7).assign, all)
  const s2 = silhouette(X, kmeans(X, 2, 7).assign, all)
  assert.ok(s3 > s2)
  const choice = chooseK(X, 2, 5)
  assert.ok(choice.scores.length >= 2)
})

test('cluster: c-TF-IDF finds the distinctive words and subjects become names', () => {
  const X = blobs.map(lexicalEmbed)
  const { assign } = kmeans(X, 3, 7)
  const kw = cTfidf(blobs, assign, 3)
  const all = kw.flat().join(' ')
  for (const w of ['tracking', 'password', 'refund']) assert.ok(all.includes(w), w)
  assert.equal(nameFromSubjects(['Order #123 not arrived', 'Order #456 not arrived', 'Re: Order #789 not arrived', 'hello']), 'Order not arrived')
  assert.equal(nameFromSubjects(['a b', 'c d', 'e f', 'g h', 'i j']), null)
})

test('cluster: layout keeps every point inside the unit square and near its own centre', () => {
  const X = blobs.map(lexicalEmbed)
  const { assign, centroids } = kmeans(X, 3, 7)
  const l = layout2d(X, assign, centroids)
  for (let i = 0; i < X.length; i++) {
    assert.ok(l.x[i] >= 0 && l.x[i] <= 1 && l.y[i] >= 0 && l.y[i] <= 1)
    const c = l.centers[assign[i]]
    assert.ok(Math.hypot(l.x[i] - c.x, l.y[i] - c.y) <= c.r + 1e-6)
  }
})

// ---------- scoring ----------

test('score: an information-only, calm, consistent intent outranks an angry escalated one', () => {
  const mk = (body: string, extra: Partial<import('./formats.ts').Ticket> = {}) => ({ id: '', subject: '', body, channel: 'chat', createdAt: null, solvedAt: null, agentReplies: ['Standard shipping takes 3-5 business days and is free over $100.'], replies: 1, reopens: 0, csat: 0.9, tags: [], escalated: false, handleMinutes: 10, ...extra })
  const info = Array.from({ length: 20 }, () => mk('How long does shipping take to Toronto?'))
  const angry = Array.from({ length: 20 }, (_, i) => mk('This is unacceptable, I want a refund and I will file a chargeback!!', { escalated: i % 2 === 0, reopens: 1, handleMinutes: 600, csat: 0.1, agentReplies: [`Sorry case ${i} escalated to lead ${i * 7}`] }))
  const a = scoreSignals(computeSignals(info, 0.8, 1, 60))
  const b = scoreSignals(computeSignals(angry, 0.6, 0, 60))
  assert.equal(a.tier, 'automatable')
  assert.equal(b.tier, 'human')
  assert.ok(a.score > b.score + 30)
  assert.ok(Math.abs(a.factors.reduce((s, f) => s + f.weight, 0) - 1) < 1e-9, 'weights renormalize to 1')
})

test('score: account-changing requests are tiered as needing an action API', () => {
  const t = (body: string) => ({ id: '', subject: 'Cancel', body, channel: 'email', createdAt: null, solvedAt: null, agentReplies: [], replies: null, reopens: null, csat: null, tags: [], escalated: false, handleMinutes: null })
  const s = scoreSignals(computeSignals(Array.from({ length: 10 }, () => t('Please cancel my order #123, I ordered the wrong size')), 0.8, 0.8, null))
  assert.equal(s.tier, 'action')
  assert.deepEqual(detectActions(['please cancel my order']).map(a => a.id), ['cancel-order'])
  assert.ok(negativity('This is UNACCEPTABLE and RIDICULOUS!!') >= 0.9)
  assert.equal(negativity('Where is my order?'), 0)
})

// ---------- end to end on the MiniLM cache ----------

const buf = readFileSync(new URL('../../public/emb/sample.bin', import.meta.url))
const cache = parseCache(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const sep = normalizeJson(sampleNdjson(0)).tickets
const oct = normalizeJson(sampleNdjson(1)).tickets
const Xsep = sep.map(t => cache.get(textKey(ticketText(t)))!)
const Xoct = oct.map(t => cache.get(textKey(ticketText(t)))!)
const sepRun = analyze({ tickets: sep, X: Xsep, embedder: 'minilm', id: 'sep', label: 'Sep', source: SRC })
const truthSep = generateSample(0).map(t => t.tags[0])
/** The intent holding most tickets planted with a given tag. */
const intentFor = (tag: string) => {
  const counts = new Map<number, number>()
  truthSep.forEach((t, i) => { if (t === tag) counts.set(sepRun.assign[i], (counts.get(sepRun.assign[i]) ?? 0) + 1) })
  return sepRun.snapshot.intents[[...counts].sort((a, b) => b[1] - a[1])[0][0]]
}

test('cache: every sample ticket and article has a precomputed embedding that round-trips quantization', () => {
  assert.ok(Xsep.every(Boolean) && Xoct.every(Boolean))
  assert.ok(SAMPLE_ARTICLES.every(a => cache.has(textKey(articleText(a)))))
  const v = normalize(Float32Array.from({ length: 384 }, (_, i) => Math.sin(i)))
  const { q, scale } = quantize(v)
  assert.ok(dot(v, dequantize(q, scale)) > 0.999)
})

test('analyze: sample discovers the planted intents with sensible tiers', () => {
  const s = sepRun.snapshot
  assert.ok(s.k >= 12 && s.k <= 22, `k=${s.k}`)
  const truth = generateSample(0).map(t => t.tags[0])
  const purity = s.intents.map((it, c) => {
    const tags = truth.filter((_, i) => sepRun.assign[i] === c)
    const top = Math.max(...[...new Set(tags)].map(t => tags.filter(x => x === t).length))
    return top / tags.length
  })
  const weighted = purity.reduce((a, p, c) => a + p * s.intents[c].size, 0) / s.total
  assert.ok(weighted > 0.75, `purity ${weighted.toFixed(2)}`)
  assert.equal(effectiveTier(intentFor('order_status')), 'automatable')
  assert.equal(effectiveTier(intentFor('product_question')), 'automatable')
  assert.equal(effectiveTier(intentFor('complaint')), 'human')
  assert.equal(effectiveTier(intentFor('cancellation')), 'action')
  assert.equal(s.intents.reduce((a, i) => a + i.size, 0), s.total)
})

test('analyze: merge and split keep every ticket assigned and preserve ids', () => {
  const s = sepRun.snapshot
  const [a, b] = s.intents
  const m = mergeIntents(s, sep, Xsep, sepRun.assign, [a.id, b.id], 'Merged')
  assert.equal(m.snapshot.intents.length, s.intents.length - 1)
  assert.ok(m.snapshot.intents.some(i => i.name === 'Merged' && i.size === a.size + b.size))
  assert.ok(Array.from(m.assign).every(x => x >= 0 && x < m.snapshot.intents.length))
  const sp = splitIntent(m.snapshot, sep, Xsep, m.assign, m.snapshot.intents.find(i => i.name === 'Merged')!.id)
  assert.equal(sp.snapshot.intents.length, s.intents.length)
  assert.equal(sp.snapshot.intents.reduce((x, i) => x + i.size, 0), s.total)
})

test('knowledge: sample articles cover tracking and leave damaged items as a gap', () => {
  const AV = SAMPLE_ARTICLES.map(a => cache.get(textKey(articleText(a)))!)
  const intents = matchArticles(sepRun.snapshot.intents, SAMPLE_ARTICLES, AV, 'minilm')
  const wismo = intents.find(i => i.id === intentFor('order_status').id)!
  assert.equal(wismo.kb!.status, 'covered')
  assert.equal(intents.find(i => i.id === intentFor('damaged').id)!.kb!.status, 'gap')
  assert.match(wismo.kb!.title, /Tracking/)
  assert.ok(intents.some(i => i.kb!.status === 'gap'))
  assert.equal(parseArticles(JSON.stringify({ articles: [{ id: 1, title: 'T', body: '<p>x</p>', html_url: 'u' }] }))[0].body, 'x')
  assert.equal(parseArticles('title,body,url\nReturns,How to return,https://x\n')[0].url, 'https://x')
  assert.equal(helpCenterUrl('acme'), 'https://acme.zendesk.com/api/v2/help_center/articles.json?per_page=100')
  assert.equal(helpCenterUrl('https://help.acme.com/hc/en-us', 'en-us'), 'https://help.acme.com/api/v2/help_center/en-us/articles.json?per_page=100')
})

test('roi: ramp is monotone, scenarios are ordered, payback is found and costs reduce net', () => {
  assert.equal(ramp(0, 4), 0); assert.equal(ramp(4, 4), 1); assert.ok(ramp(2, 4) > ramp(1, 4))
  const s = sepRun.snapshot
  const c = project(s, DEFAULT_ROI, 'conservative'), b = project(s, DEFAULT_ROI, 'base'), o = project(s, DEFAULT_ROI, 'optimistic')
  assert.ok(c.fullRamp.net < b.fullRamp.net && b.fullRamp.net < o.fullRamp.net)
  assert.ok(b.paybackMonth! > 0 && b.paybackMonth! < 12)
  const pricey = project(s, { ...DEFAULT_ROI, pricePerResolution: 5 }, 'base')
  assert.ok(pricey.fullRamp.net < b.fullRamp.net)
  const human = s.intents.find(i => effectiveTier(i) === 'human')!
  assert.equal(intentRate(human, DEFAULT_ROI, 'optimistic'), 0)
  const manual = b.monthly.reduce((a, m) => a + m.net, 0)
  assert.ok(Math.abs(manual - b.totalNet) < 1e-6)
})

test('outputs: roadmap waves, catalogue CSV and override effects', () => {
  const s = sepRun.snapshot
  const r = roadmap(s, DEFAULT_ROI)
  assert.equal(r.length, s.intents.length)
  assert.ok(r.some(x => x.wave === 'now'))
  assert.ok(r.filter(x => x.wave === 'human').every(x => effectiveTier(x.intent) === 'human'))
  const cat = catalogue(s, sep, sepRun.assign)
  assert.ok(cat[0].example_phrasings.length >= 3)
  assert.ok(cat[0].suggested_answer_outline.length >= 1)
  assert.ok(cat.every(e => !/@gmail\.com/.test(e.example_phrasings.join(' '))))
  const csv = parseCsv(catalogueCsv(cat))
  assert.equal(csv.rows.length, cat.length)
  assert.ok(csv.header.includes('required_actions'))
  const overridden: Snapshot = { ...s, intents: s.intents.map((i, k) => (k === 0 ? { ...i, override: 'human' as const } : i)) }
  assert.ok(project(overridden, DEFAULT_ROI, 'base').fullRamp.resolved < project(s, DEFAULT_ROI, 'base').fullRamp.resolved)
})

test('compare: re-using the catalogue shows order-status share falling after the AI launch', () => {
  const octRun = analyze({ tickets: oct, X: Xoct, embedder: 'minilm', id: 'oct', label: 'Oct', source: SRC, previous: sepRun.snapshot })
  assert.equal(octRun.snapshot.catalogue, 'sep')
  assert.ok(Array.from(octRun.assign).every(x => x >= 0))
  const rows = compareSnapshots(sepRun.snapshot, octRun.snapshot)
  const wismo = rows.find(r => r.id === intentFor('order_status').id)!
  assert.equal(wismo.name, intentFor('order_status').name, 'names carry over with the catalogue')
  assert.ok(wismo.delta < -0.02, `delta ${wismo.delta}`)
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.shareB, 0) - 1) < 1e-9)
})
