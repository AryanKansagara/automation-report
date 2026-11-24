import { readFileSync } from 'node:fs'
import { test, expect, openSample } from './fixtures.ts'

// Planted, fictional PII. None of these strings may survive redaction.
const PLANTED = ['jane.planted@example.com', '415-555-0132', '4111 1111 1111 1111', '203.0.113.42', 'Zed Plantington', '742 Evergreen Terrace']

const row = (n: number, subject: string, body: string) => `${n},"${subject}","${body}",2026-10-${String(1 + (n % 27)).padStart(2, '0')}T09:00:00Z`
const TICKETS_CSV = [
  'id,subject,description,created_at',
  row(1, 'Where is my order', 'Hi, where is my order? Email me at jane.planted@example.com or call 415-555-0132.'),
  row(2, 'Charged twice', 'I was charged twice. My card 4111 1111 1111 1111 was billed, my IP was 203.0.113.42.'),
  row(3, 'Change delivery address', 'Hello, my name is Zed Plantington and I live at 742 Evergreen Terrace. Please update it.'),
  ...Array.from({ length: 12 }, (_, i) => row(4 + i, 'Reset my password', `I cannot log in and need a password reset, attempt number ${i + 1}.`)),
].join('\n') + '\n'

test('opens the precomputed sample and shows intents and the ROI result', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Try the sample/ }).first().click()
  await page.waitForURL(/\/app\/p\//, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Northwind Outfitters (synthetic sample)' })).toBeVisible()
  await expect(page.getByText('1,400 tickets')).toBeVisible()
  await expect(page.getByText('AI could resolve')).toBeVisible()
  await expect(page.getByText('Net savings, first 12 mo')).toBeVisible()

  await page.getByRole('tab', { name: /^Intents/ }).click()
  await expect(page.getByRole('row', { name: /Where is my order\?/ })).toBeVisible()
  expect(await page.locator('tbody tr').count()).toBeGreaterThanOrEqual(10)

  await page.getByRole('tab', { name: /^ROI/ }).click()
  await expect(page.getByRole('heading', { name: 'Cumulative net savings' })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Base / })).toBeVisible()
})

test('overriding a verdict changes the report', async ({ page }) => {
  await openSample(page)
  const share = page.locator('.chip', { hasText: 'Human only' })
  const before = await share.innerText()

  await page.getByRole('tab', { name: /^Intents/ }).click()
  await page.getByRole('row', { name: /Where is my order\?/ }).click()
  const drawer = page.getByRole('complementary', { name: /Intent Where is my order\?/ })
  await drawer.getByRole('group', { name: 'Override verdict' }).getByRole('button', { name: 'Human' }).click()
  await expect(drawer.getByText('set by you')).toBeVisible()

  await page.getByRole('tab', { name: /^Overview/ }).click()
  await expect(share).not.toHaveText(before)
})

test('changing an ROI input changes the savings, and it survives a reload', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: /^ROI/ }).click()
  const net = page.locator('.kpi', { hasText: 'Net savings' }).locator('b')
  const before = await net.innerText()

  await page.getByLabel('One-time setup cost').fill('40000')
  await expect(net).not.toHaveText(before)
  const after = await net.innerText()

  await page.reload()
  await expect(page.getByLabel('One-time setup cost')).toHaveValue('40000')
  await expect(net).toHaveText(after)
})

test('the workspace and the sample persist across a reload', async ({ page }) => {
  await openSample(page)
  const url = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Northwind Outfitters (synthetic sample)' })).toBeVisible()
  await expect(page.getByText('Intent map')).toBeVisible()

  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByText('Northwind Outfitters (synthetic sample)')).toBeVisible()
  await page.goto(url)
  await expect(page.getByText('AI could resolve')).toBeVisible()
})

test('imports a synthetic CSV through the redaction preview and removes planted PII', async ({ page }) => {
  await page.goto('/app/import')
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-tickets.csv', mimeType: 'text/csv', buffer: Buffer.from(TICKETS_CSV) })

  await expect(page.getByText('Detected')).toBeVisible()
  await expect(page.getByLabel('Subject', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /Validate and redact/ }).click()

  await expect(page.getByRole('heading', { name: 'Redaction preview' })).toBeVisible()
  await expect(page.locator('.kpi', { hasText: 'Tickets imported' }).locator('b')).toHaveText('15')
  const pii = page.locator('.kpi', { hasText: 'PII redacted' })
  for (const kind of ['emails', 'phone numbers', 'card numbers', 'ip addresses', 'addresses', 'names']) await expect(pii).toContainText(kind)

  // "Original" shows the planted values highlighted; "Stored and analyzed" must not contain any.
  const originals = page.locator('.redact-pair > div:first-child .well')
  const stored = page.locator('.redact-pair > div:last-child .well')
  await expect(stored).toHaveCount(3)
  const originalText = (await originals.allInnerTexts()).join('\n')
  const storedText = (await stored.allInnerTexts()).join('\n')
  expect(PLANTED.filter(p => originalText.includes(p)).length).toBeGreaterThanOrEqual(4)
  for (const p of PLANTED) expect(storedText, `stored text still contains ${p}`).not.toContain(p)
  for (const token of ['[EMAIL]', '[PHONE]', '[CARD]', '[IP]', '[NAME]']) expect(storedText).toContain(token)
  await expect(page.getByRole('button', { name: /Analyze 15 tickets/ })).toBeEnabled()
})

// Synthetic import with planted values in the ticket id, tags, channel, an accented name and IPv6 (see e2e/data).
const REDACTION_CSV = new URL('./data/redaction-import.csv', import.meta.url).pathname
const PLANTED_FIELDS = ['alex.sample@example.com', 'sam.sample@example.net', 'erin.sample@example.com', 'josé@exämple.com', '415-555-0147', 'José', 'Álvarez', 'Élodie', 'Zed', '2001:db8::8a2e:370:7334']

test('redacts planted values in ids, tags, channel, accented names and IPv6 everywhere they are stored or shown', async ({ page }) => {
  // The model download is blocked in tests, so analyze with the offline embedder.
  await page.goto('/app/settings')
  await page.getByRole('radio', { name: /Lexical/ }).check()

  await page.goto('/app/import')
  await page.locator('input[type=file]').setInputFiles(REDACTION_CSV)
  await page.getByRole('button', { name: /Validate and redact/ }).click()
  await expect(page.getByRole('heading', { name: 'Redaction preview' })).toBeVisible()

  // Two different email ids stay two tickets; the true duplicate collapses (16 rows, 15 tickets, 1 issue).
  await expect(page.locator('.kpi', { hasText: 'Tickets imported' })).toContainText('of 16 rows')
  await expect(page.locator('.kpi', { hasText: 'Tickets imported' }).locator('b')).toHaveText('15')
  const pii = page.locator('.kpi', { hasText: 'PII redacted' })
  await expect(pii).toContainText('5 emails')
  await expect(pii).toContainText('3 names')
  await expect(pii).toContainText('1 ip addresses')
  await expect(pii).toContainText('1 phone numbers')

  // The validation report names the duplicate by line, never by value.
  const report = page.locator('.card', { has: page.getByRole('heading', { name: 'Validation report' }) })
  await expect(report).toContainText('Duplicate ticket id (first seen on line 2); kept the first')
  const reportText = await report.innerText()
  for (const p of PLANTED_FIELDS) expect(reportText, `validation report contains ${p}`).not.toContain(p)

  // The stored side of the preview is redacted; the "Original" side deliberately shows the file.
  const stored = (await page.locator('.redact-pair > div:last-child .well').allInnerTexts()).join('\n')
  const originals = (await page.locator('.redact-pair > div:first-child .well').allInnerTexts()).join('\n')
  expect(originals).toContain('José Álvarez')
  expect(originals).toContain('2001:db8::8a2e:370:7334')
  for (const p of PLANTED_FIELDS) expect(stored, `stored preview contains ${p}`).not.toContain(p)
  expect(stored).toContain('my name is [NAME] and I connected from [IP].')
  expect(stored).toContain('MY NAME IS [NAME]. Please write to [EMAIL]')
  expect(stored).toContain('Hello, my name is [NAME]. my name is wrong on the invoice')

  await page.getByRole('button', { name: /Analyze 15 tickets/ }).click()
  await page.waitForURL(/\/app\/p\/[^/]+$/, { timeout: 60_000 })
  await expect(page.getByText('AI could resolve')).toBeVisible()

  // What is stored in IndexedDB and what the full export writes out contains none of the planted values.
  const local = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open('automation-report')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = open.result.transaction('local').objectStore('local').getAll()
      req.onsuccess = () => resolve(JSON.stringify(req.result.map((r: { tickets?: unknown }) => r.tickets ?? null)))
      req.onerror = () => reject(req.error)
    }
  }))
  expect(local).toContain('"T-1004"')
  expect(local).toContain('10:30:45 on device 00:1A:2B:3C:4D:5E running v2.4.1')
  for (const p of PLANTED_FIELDS) expect(local, `IndexedDB tickets contain ${p}`).not.toContain(p)

  await page.goto('/app/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export all/ }).click()])
  const exported = readFileSync((await download.path())!, 'utf8')
  expect(exported).toContain('redacted-')
  for (const p of PLANTED_FIELDS) expect(exported, `export contains ${p}`).not.toContain(p)
})

test('unreadable and wrong-format files show a message and the app stays usable', async ({ page }) => {
  await page.goto('/app/import')
  const input = page.locator('input[type=file]')
  const alert = page.getByRole('alert')

  await input.setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) })
  await expect(alert).toHaveText('That file is empty.')

  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just one line of text with no header row\n') })
  await expect(alert).toContainText('does not look like a CSV')

  await input.setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') })
  await expect(alert).toContainText('No tickets found in that JSON')

  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"id": 1, "subject": ') })
  await expect(alert).toBeVisible()

  // Still on the file step and still working: a valid file is accepted afterwards.
  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible()
  await input.setInputFiles({ name: 'synthetic-tickets.csv', mimeType: 'text/csv', buffer: Buffer.from(TICKETS_CSV) })
  await expect(page.getByRole('button', { name: /Validate and redact/ })).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('the app works signed out with Supabase blocked', async ({ page, blocked }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible()
  await openSample(page)
  await page.goto('/app/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  expect(blocked.filter(u => /supabase/i.test(u))).toEqual([])
})
