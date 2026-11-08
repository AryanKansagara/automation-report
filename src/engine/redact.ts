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
const RULES: { kind: PiiKind; re: RegExp; check?: (m: string) => boolean; opt?: keyof RedactOptions }[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'card', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: m => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) } },
  { kind: 'phone', re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g },
  { kind: 'phone', re: /\+\d[\d\s().-]{8,16}\d/g },
  { kind: 'phone', re: /(?<=\b(?:phone|call|text|cell|mobile|tel|number is)[:\s]+(?:me\s+(?:at|on)\s+)?)\d{10,11}\b/gi },
  { kind: 'ip', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: 'address', opt: 'addresses', re: new RegExp(`\\b\\d{1,5}\\s+(?:[A-Z][A-Za-z'.]*\\s+){1,4}(?:${SUFFIX})\\b\\.?(?:,?\\s*(?:Apt|Unit|Suite|#)\\.?\\s*[\\w-]+)?`, 'g') },
  { kind: 'address', opt: 'addresses', re: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d\b/g },
  { kind: 'address', opt: 'addresses', re: /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|ON|QC|BC|AB)\s+\d{5}(?:-\d{4})?\b/g },
  { kind: 'name', opt: 'names', re: /(?<=\b(?:[Mm]y name is|[Nn]ame:)\s+)[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?/g },
]

export function findPii(text: string, opts: RedactOptions = {}): Span[] {
  const o = { addresses: true, names: true, ...opts }
  const found: Span[] = []
  for (const r of RULES) {
    if (r.opt && !o[r.opt]) continue
    for (const m of text.matchAll(r.re)) {
      if (r.check && !r.check(m[0])) continue
      found.push({ start: m.index!, end: m.index! + m[0].length, kind: r.kind })
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
