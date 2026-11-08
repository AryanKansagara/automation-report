// RFC 4180 CSV parser that remembers the source line each record started on,
// so the validation report can point at real line numbers in the user's file.

export interface CsvTable {
  header: string[]
  rows: string[][]
  /** 1-based source line where each row starts (header is line 1 for a normal file). */
  lines: number[]
  delimiter: string
  issues: { line: number; message: string }[]
}

export function detectDelimiter(text: string): string {
  const head = text.slice(0, 4000).split(/\r?\n/).filter(l => l.trim()).slice(0, 5)
  let best = ',', bestScore = -1
  for (const d of [',', ';', '\t', '|']) {
    const counts = head.map(l => l.split(d).length - 1)
    const score = counts[0] > 0 && counts.every(c => c >= counts[0] * 0.5) ? counts[0] : 0
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const records: string[][] = []
  const starts: number[] = []
  let field = '', row: string[] = [], inQuotes = false, line = 1, rowStart = 1
  const issues: CsvTable['issues'] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else {
        if (c === '\n') line++
        field += c
      }
      continue
    }
    if (c === '"' && field === '') inQuotes = true
    else if (c === delimiter) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') { records.push(row); starts.push(rowStart) }
      row = []
      line++
      rowStart = line
    } else field += c
  }
  if (inQuotes) issues.push({ line: rowStart, message: 'Unclosed quote: the rest of the file was read as one field' })
  row.push(field)
  if (row.length > 1 || row[0] !== '') { records.push(row); starts.push(rowStart) }
  const header = (records.shift() ?? []).map(h => h.trim())
  starts.shift()
  records.forEach((r, i) => {
    if (r.length !== header.length) issues.push({ line: starts[i], message: `Expected ${header.length} columns, found ${r.length}` })
  })
  return { header, rows: records, lines: starts, delimiter, issues }
}

function cell(v: unknown): string {
  const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n'
}
