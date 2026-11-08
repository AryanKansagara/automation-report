// Strips HTML, quoted replies, signatures and email boilerplate so clustering
// sees what the customer actually asked, not the thread history.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function stripHtml(s: string): string {
  if (!/<[a-z!/][^>]*>/i.test(s)) return s
  return s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : m))
}

// A line matching any of these ends the useful part of the message.
const CUT = [
  /^\s*On .{4,120}wrote:\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  /^\s*From:\s.+$/i,
  /^\s*_{8,}\s*$/,
  /^--\s*$/,
  /^\s*Sent from my (iPhone|iPad|Android|Galaxy|mobile|Samsung)/i,
  /^\s*Get Outlook for /i,
  /^\s*(This (e-?mail|message)( and any attachments)? (is|are|may be) (confidential|intended))/i,
  /^\s*(CONFIDENTIALITY NOTICE|DISCLAIMER)\b/i,
  /^\s*To unsubscribe\b/i,
  /^\s*##- Please type your reply above this line -##/i,
]
const SIGNOFF = /^\s*(thanks|thank you|thanks again|many thanks|regards|kind regards|best regards|best|cheers|sincerely|warm regards|all the best|thx|ty)[,.!]*\s*$/i
const GREETING = /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^\n]{0,40}[,!]?\s*$/i
const NOISE = /\[cid:[^\]]*\]|\[image:[^\]]*\]|\[https?:[^\]]*\]/gi

export function cleanMessage(raw: string): string {
  const lines = stripHtml(raw).replace(NOISE, '').replace(/\r/g, '').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (CUT.some(re => re.test(line))) break
    if (/^\s*>/.test(line)) continue
    out.push(line)
  }
  // Drop a trailing sign-off and the short lines after it (name, title, company).
  for (let i = out.length - 1; i >= Math.max(0, out.length - 6); i--) {
    if (SIGNOFF.test(out[i])) { out.length = i; break }
  }
  while (out.length && GREETING.test(out[0])) out.shift()
  return out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
