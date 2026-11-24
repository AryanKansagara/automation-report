import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { redact, findPii, isIpv6 } from './redact.ts'
import { sniff, normalizeCsv, normalizeJson, parseTags } from './formats.ts'
import { analyze } from './analyze.ts'
import { catalogue, catalogueCsv, roadmap } from './outputs.ts'
import { lexicalEmbed, ticketText } from './lexical.ts'
import { DEFAULT_ROI } from './roi.ts'

// All values below are synthetic (documentation address ranges, example domains, invented names).
const text = (s: string, o?: Parameters<typeof redact>[1]) => redact(s, o).text

function importCsv(csv: string) {
  const s = sniff(csv)
  if (s.kind !== 'csv') throw new Error('expected csv')
  return normalizeCsv(s.table, s.mapping, s.format)
}

// ---------- names, emails, IPv6 ----------

test('redact: unicode names are removed whole, with no leftover fragments', () => {
  assert.equal(text('my name is José Álvarez'), 'my name is [NAME]')
  assert.equal(text('my name is Élodie Roy'), 'my name is [NAME]')
  assert.equal(text("Name: Zoë O'Neil-Smith"), 'Name: [NAME]')
  assert.equal(text('Hi, my name is Priya Patel and I need help'), 'Hi, my name is [NAME] and I need help')
})

test('redact: name cues are case-insensitive', () => {
  assert.equal(text('MY NAME IS Zed'), 'MY NAME IS [NAME]')
  assert.equal(text('My Name Is Zed Plantington.'), 'My Name Is [NAME].')
  assert.equal(text('NAME: Ana'), 'NAME: [NAME]')
})

test('redact: short names that are also ordinary words are redacted', () => {
  assert.equal(text('My name is An Nguyen'), 'My name is [NAME]')
  assert.equal(text('My name is Kim So'), 'My name is [NAME]')
  assert.equal(text('My name is Kim An.'), 'My name is [NAME].')
  assert.equal(text('MY NAME IS ZED AND I NEED HELP'), 'MY NAME IS [NAME] AND I NEED HELP')
})

test('redact: ordinary phrases after "my name is" are not names', () => {
  for (const s of ['my name is wrong on the invoice', 'My name is wrong on the invoice', 'My name is Wrong on the invoice', 'my name is spelled wrong', 'my name is not on the list']) {
    assert.equal(text(s), s)
  }
})

test('redact: a name stops at the end of the line and at lowercase words', () => {
  assert.equal(text('my name is Jane\nThanks for the help'), 'my name is [NAME]\nThanks for the help')
  assert.equal(text('my name is Jane and I live here'), 'my name is [NAME] and I live here')
})

test('redact: the names option still turns name redaction off', () => {
  assert.equal(redact('my name is José Álvarez', { names: false }).spans.length, 0)
})

test('redact: emails with non-ASCII letters', () => {
  assert.equal(text('mail josé@exämple.com please'), 'mail [EMAIL] please')
  assert.equal(text('write to zoë.o-neil+tag@bücher.example.'), 'write to [EMAIL].')
  assert.equal(text('Jane.Doe@Example.COM'), '[EMAIL]')
})

test('redact: IPv6 addresses in their common forms', () => {
  for (const ip of ['2001:db8::8a2e:370:7334', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', '::1', 'fe80::1', '2001:db8::', '::ffff:192.0.2.1', '2001:DB8::FF00:42:8329']) {
    assert.equal(text(`ip ${ip}`), 'ip [IP]', ip)
    assert.equal(text(`ip ${ip}.`), 'ip [IP].', `${ip} at the end of a sentence`)
    assert.equal(text(`from [${ip}]:8080 ok`), 'from [[IP]]:8080 ok', `${ip} in brackets`)
  }
  assert.equal(text('ip 2001:db8::8a2e:370:7334'), 'ip [IP]')
})

test('redact: times, MAC addresses, version numbers and order numbers are not matched', () => {
  const keep = [
    'The call was at 10:30:45 today', 'Logged 10:30:45.123 and 23:59', 'Timestamp 2026-10-01T09:00:00Z',
    'MAC 00:1A:2B:3C:4D:5E', 'EUI-64 00:1a:2b:3c:4d:5e:6f:70', 'MAC 00-1A-2B-3C-4D-5E',
    'Running v2.4.1 and 10.2.3', 'Order #100234 and ticket 4815162342', 'Ratio 3:1 or score 2:2:2',
    'See std::string and Foo::bar', 'Ends with 12:34:56:78 only',
  ]
  for (const s of keep) assert.deepEqual(findPii(s), [], s)
})

test('redact: isIpv6 rejects malformed addresses', () => {
  for (const bad of ['1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1::2::3', ':::', '::', '12345::1', 'g::1', '1:2:3:4:5:6:7::8', '::ffff:999.0.2.1', '1.2.3.4']) {
    assert.equal(isIpv6(bad), false, bad)
  }
})

test('redact: IPv4 still works and is not shadowed by the IPv6 rule', () => {
  assert.equal(text('ip 203.0.113.42 here'), 'ip [IP] here')
})

// ---------- ids, tags and channel ----------

const csv = (rows: string[][]) => rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'

test('formats: different email ids stay two tickets; a true duplicate still collapses', () => {
  const { tickets, report } = importCsv(csv([
    ['id', 'subject', 'description'],
    ['alex.sample@example.com', 'Refund', 'where is my refund'],
    ['sam.sample@example.net', 'Invoice', 'question about my invoice'],
    ['alex.sample@example.com', 'Refund again', 'same ticket twice'],
  ]))
  assert.equal(tickets.length, 2)
  assert.equal(new Set(tickets.map(t => t.id)).size, 2)
  assert.ok(tickets.every(t => !/@/.test(t.id)))
  assert.equal(report.imported, 2)
  assert.equal(report.issues.length, 1)
  assert.equal(report.issues[0].line, 4)
  assert.equal(report.pii.email, 2)
})

test('formats: plain ids are unchanged, and a neutral id never collides with a plain one', () => {
  const { tickets } = importCsv(csv([
    ['id', 'subject', 'description'],
    ['T-100', 'a', 'one'],
    ['alex.sample@example.com', 'b', 'two'],
    ['redacted-3', 'c', 'three'],
    ['12345', 'd', 'four'],
  ]))
  assert.deepEqual(tickets.map(t => t.id).filter(id => !id.startsWith('redacted-')), ['T-100', '12345'])
  assert.equal(new Set(tickets.map(t => t.id)).size, 4)
  assert.ok(tickets.some(t => t.id === 'redacted-3'), 'the plain id is kept as given')
})

test('formats: ids that are PII are neutral in JSON exports too', () => {
  const line = (id: string, subject: string) => JSON.stringify({ id, subject, description: 'hello', via: { channel: 'email' }, tags: ['refund'] })
  const { tickets } = normalizeJson([line('jo.sample@example.com', 'a'), line('kim.sample@example.com', 'b'), line('42', 'c')].join('\n'))
  assert.equal(tickets.length, 3)
  assert.equal(new Set(tickets.map(t => t.id)).size, 3)
  assert.equal(tickets[2].id, '42')
  assert.ok(!JSON.stringify(tickets).includes('sample@example.com'))
})

test('formats: PII in channel and tags is redacted and counted', () => {
  const { tickets, report } = importCsv(csv([
    ['id', 'subject', 'description', 'channel', 'tags'],
    ['1', 'a', 'one', 'chat with sam.sample@example.net', 'vip,callback-415-555-0147,billing'],
    ['2', 'b', 'two', 'Email', 'refund'],
  ]))
  assert.equal(tickets[0].channel, 'chat with [EMAIL]')
  assert.deepEqual(tickets[0].tags, ['vip', 'callback-[PHONE]', 'billing'])
  assert.equal(tickets[1].channel, 'email', 'plain channels are still lowercased')
  assert.deepEqual(tickets[1].tags, ['refund'])
  assert.equal(report.pii.email, 1)
  assert.equal(report.pii.phone, 1)
})

test('formats: a phone number split by spaces inside Zendesk-style tags is still redacted', () => {
  const { tickets } = importCsv(csv([
    ['id', 'subject', 'description', 'tags'],
    ['1', 'a', 'one', 'billing 415 555 0147 vip'],
  ]))
  assert.deepEqual(tickets[0].tags, ['billing', '[PHONE]', 'vip'])
})

test('formats: tag parsing is unchanged for plain tags', () => {
  assert.deepEqual(parseTags('a b  c'), ['a', 'b', 'c'])
  assert.deepEqual(parseTags('a, b c ,d'), ['a', 'b c', 'd'])
  assert.deepEqual(parseTags(['x', { name: 'y' }]), ['x', 'y'])
  assert.deepEqual(parseTags({ tags: [{ name: 'z' }] }), ['z'])
  const { tickets } = importCsv(csv([['id', 'subject', 'description', 'tags'], ['1', 'a', 'one', 'Billing,VIP Customer']]))
  assert.deepEqual(tickets[0].tags, ['billing', 'vip customer'])
})

test('formats: escalation is still detected from a tag that carries PII', () => {
  const { tickets } = importCsv(csv([
    ['id', 'subject', 'description', 'tags'],
    ['1', 'a', 'one', 'escalated-by-erin.sample@example.com'],
    ['2', 'b', 'two', 'manager 415-555-0147'],
    ['3', 'c', 'three', 'refund'],
  ]))
  assert.deepEqual(tickets.map(t => t.escalated), [true, true, false])
  assert.deepEqual(tickets[0].tags, ['[EMAIL]'])
})

test('formats: validation messages never contain the raw value', () => {
  const planted = ['dup.sample@example.com', 'Zed Plantington', '415-555-0147']
  const { report } = importCsv(csv([
    ['id', 'subject', 'description', 'created_at'],
    [planted[0], 'a', 'one', 'my name is Zed Plantington 415-555-0147'],
    [planted[0], 'b', 'two', '2026-10-01'],
    ['T-2', 'c', 'three', 'call 415-555-0147 about Zed Plantington'],
  ]))
  assert.ok(report.issues.length >= 2)
  const messages = report.issues.map(i => i.message).join('\n')
  for (const p of planted) assert.ok(!messages.includes(p), `message contains ${p}`)
  assert.ok(report.issues.some(i => /Unreadable created date/.test(i.message)))
  assert.ok(report.issues.some(i => /Duplicate ticket id/.test(i.message)))
})

// ---------- the shared synthetic import ----------

const PLANTED = [
  'alex.sample@example.com', 'sam.sample@example.net', 'erin.sample@example.com', 'josé@exämple.com', '415-555-0147',
  'José', 'Álvarez', 'Élodie', 'Zed', '2001:db8::8a2e:370:7334',
]
const fixture = readFileSync(new URL('../../e2e/data/redaction-import.csv', import.meta.url), 'utf8')

test('fixture import: planted values are absent from tickets, report messages and the redaction counts add up', () => {
  const { tickets, report } = importCsv(fixture)
  assert.equal(report.total, 16)
  assert.equal(report.imported, 15)
  assert.equal(report.issues.length, 1)
  const stored = JSON.stringify(tickets)
  const messages = report.issues.map(i => i.message).join('\n')
  for (const p of PLANTED) {
    assert.ok(!stored.includes(p), `tickets contain ${p}`)
    assert.ok(!messages.includes(p), `messages contain ${p}`)
  }
  // ids (2) + channel (1) + tags (1) + body (1) = 5 emails; phone from a tag; ip from the body; 3 names.
  assert.deepEqual(report.pii, { email: 5, phone: 1, ip: 1, name: 3 })
  const byLine = (n: number) => tickets.find(t => t.subject.startsWith(['Refund for my order', 'Question about my invoice', '', 'Name on the invoice', 'Device log question'][n - 1]))!
  assert.equal(byLine(1).body, 'Hi, my name is [NAME] and I connected from [IP]. Please refund order 100234.')
  assert.equal(byLine(2).channel, 'chat [EMAIL]')
  assert.equal(byLine(2).escalated, true)
  assert.match(byLine(4).body, /^Hello, my name is \[NAME\]\. my name is wrong on the invoice/)
  assert.equal(byLine(5).body, 'The log shows 10:30:45 on device 00:1A:2B:3C:4D:5E running v2.4.1 for order #100234.')
  assert.equal(tickets.find(t => t.id === 'T-1004')!.id, 'T-1004')
})

test('fixture import: planted values are absent from the snapshot, catalogue, CSV and roadmap exports', () => {
  const { tickets, report } = importCsv(fixture)
  const X = tickets.map(t => lexicalEmbed(ticketText(t)))
  const run = analyze({ tickets, X, embedder: 'lexical', id: 's', label: 'Oct', source: { format: report.format, fileName: 'f.csv', total: report.total, imported: report.imported, pii: report.pii }, k: 3 })
  const cat = catalogue(run.snapshot, tickets, run.assign)
  const out = [JSON.stringify(run.snapshot), JSON.stringify(cat), catalogueCsv(cat), JSON.stringify(roadmap(run.snapshot, DEFAULT_ROI))].join('\n')
  for (const p of PLANTED) assert.ok(!out.includes(p), `exports contain ${p}`)
})
