// PII redaction. Runs before any other processing, so nothing downstream
// (cleaning, embedding, storage, sync) ever sees the raw values.

export type PiiKind = 'email' | 'phone' | 'card' | 'address' | 'name' | 'ip'
export interface Span { start: number; end: number; kind: PiiKind }
export interface Redaction { text: string; spans: Span[] }
export interface RedactOptions { addresses?: boolean; names?: boolean }

const TOKEN: Record<PiiKind, string> = { email: '[EMAIL]', phone: '[PHONE]', card: '[CARD]', address: '[ADDRESS]', name: '[NAME]', ip: '[IP]' }

function luhn(digits: string): boolean {
  let sum = 0, alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

const SUFFIX = 'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Crescent|Cres|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Square|Sq'

// A name after a self-introduction cue: one or two words, each starting with a capital letter
// (any script that has case), so "my name is José Álvarez" is caught but "my name is wrong on the invoice" is not.
const NAME_WORD = "\\p{L}[\\p{L}\\p{M}'’-]*"
const NAME_STOP = new Set('a an and or but so on in at the is was i im for to from with please here there wrong incorrect correct right not misspelled spelled missing different listed shown printed'.split(' '))
function nameLength(m: string): number {
  let end = 0
  for (const w of [...m.matchAll(/\S+/gu)].slice(0, 2)) {
    const word = w[0].replace(/['’-]+$/, '')
    // "An" and "So" are real names: a short title-case word is redacted, the safer error.
    const shortTitle = /^\p{Lu}\p{Ll}{1,2}$/u.test(word)
    if (!/^\p{Lu}/u.test(word) || (!shortTitle && NAME_STOP.has(word.toLowerCase()))) break
    end = w.index + word.length
  }
  return end
}

/** True for a syntactically valid IPv6 address. Times (10:30:45), MAC addresses and version numbers are not. */
export function isIpv6(s: string): boolean {
  if (!/^[0-9A-Fa-f:.]+$/.test(s)) return false
  const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    if ([v4[2], v4[3], v4[4], v4[5]].some(o => +o > 255)) return false
    s = `${v4[1]}0:0`
  }
  if (s.includes('.')) return false
  const parts = s.split('::')
  if (parts.length > 2) return false
  const groups = (x: string) => (x === '' ? [] : x.split(':'))
  const ok = (g: string[]) => g.every(h => /^[0-9A-Fa-f]{1,4}$/.test(h))
  if (parts.length === 1) {
    const g = groups(s)
    // Eight pairs of hex digits is an EUI-64 / colon-hex byte string, not an address.
    return g.length === 8 && ok(g) && !g.every(h => h.length === 2)
  }
  const a = groups(parts[0]), b = groups(parts[1])
  return ok(a) && ok(b) && a.length + b.length >= 1 && a.length + b.length <= 7
}
const ipv6Length = (m: string) => { const t = m.replace(/\.+$/, ''); return isIpv6(t) ? t.length : 0 }

const RULES: { kind: PiiKind; re: RegExp; check?: (m: string) => boolean; take?: (m: string) => number; opt?: keyof RedactOptions }[] = [
  { kind: 'email', re: /[\p{L}\p{M}\p{N}._%+-]+@[\p{L}\p{M}\p{N}.-]+\.\p{L}{2,}/gu },
  { kind: 'card', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: m => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) } },
  { kind: 'phone', re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g },
  { kind: 'phone', re: /\+\d[\d\s().-]{8,16}\d/g },
  { kind: 'phone', re: /(?<=\b(?:phone|call|text|cell|mobile|tel|number is)[:\s]+(?:me\s+(?:at|on)\s+)?)\d{10,11}\b/gi },
  { kind: 'ip', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: 'ip', re: /(?<![\p{L}\p{N}_:.])[0-9A-Fa-f:.]{2,45}(?![\p{L}\p{N}_:])/gu, take: ipv6Length },
  { kind: 'address', opt: 'addresses', re: new RegExp(`\\b\\d{1,5}\\s+(?:[A-Z][A-Za-z'.]*\\s+){1,4}(?:${SUFFIX})\\b\\.?(?:,?\\s*(?:Apt|Unit|Suite|#)\\.?\\s*[\\w-]+)?`, 'g') },
  { kind: 'address', opt: 'addresses', re: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d\b/g },
  { kind: 'address', opt: 'addresses', re: /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|ON|QC|BC|AB)\s+\d{5}(?:-\d{4})?\b/g },
  { kind: 'name', opt: 'names', re: new RegExp(`(?<=\\b(?:my\\s+name\\s+is|name:)\\s+)${NAME_WORD}(?:[ \\t]+${NAME_WORD})?`, 'giu'), take: nameLength },
]

export function findPii(text: string, opts: RedactOptions = {}): Span[] {
  const o = { addresses: true, names: true, ...opts }
  const found: Span[] = []
  for (const r of RULES) {
    if (r.opt && !o[r.opt]) continue
    for (const m of text.matchAll(r.re)) {
      if (r.check && !r.check(m[0])) continue
      const len = r.take ? r.take(m[0]) : m[0].length
      if (len > 0) found.push({ start: m.index!, end: m.index! + len, kind: r.kind })
    }
  }
  // Keep the earliest, then longest, non-overlapping spans.
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Span[] = []
  for (const s of found) if (!out.length || s.start >= out[out.length - 1].end) out.push(s)
  return out
}

export function redact(text: string, opts?: RedactOptions): Redaction {
  const spans = findPii(text, opts)
  let res = '', at = 0
  for (const s of spans) { res += text.slice(at, s.start) + TOKEN[s.kind]; at = s.end }
  return { text: res + text.slice(at), spans }
}

export function countKinds(spans: Span[], into: Partial<Record<PiiKind, number>> = {}) {
  for (const s of spans) into[s.kind] = (into[s.kind] ?? 0) + 1
  return into
}
