// Help-centre articles: parse exports, match each intent to its best article.

import { parseCsv } from './csv.ts'
import { stripHtml } from './clean.ts'
import { dot } from './util.ts'
import { unpackCentroid, type Embedder, type Intent, type KbMatch } from './analyze.ts'

export interface Article { id: string; title: string; body: string; url?: string }

/** Zendesk Help Center API JSON, an array of articles, or a CSV with title/body/url columns. */
export function parseArticles(text: string): Article[] {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t)
    const arr: any[] = Array.isArray(j) ? j : j.articles ?? j.data ?? []
    return arr.map((a, i) => toArticle(String(a.id ?? i), a.title ?? a.name, a.body ?? a.content ?? a.description, a.html_url ?? a.url)).filter(a => a.title)
  }
  const tb = parseCsv(text)
  const col = (...names: string[]) => tb.header.findIndex(h => names.includes(h.toLowerCase()))
  const ti = col('title', 'name', 'article title'), bi = col('body', 'content', 'text', 'article body', 'description'), ui = col('url', 'html_url', 'link'), ii = col('id', 'article id')
  if (ti < 0) throw new Error('Articles CSV needs a "title" column (and ideally "body" and "url")')
  return tb.rows.map((r, i) => toArticle(ii >= 0 ? r[ii] : String(i), r[ti], bi >= 0 ? r[bi] : '', ui >= 0 ? r[ui] : undefined)).filter(a => a.title)
}

function toArticle(id: string, title: unknown, body: unknown, url: unknown): Article {
  return { id, title: String(title ?? '').trim(), body: stripHtml(String(body ?? '')).replace(/\s+/g, ' ').trim().slice(0, 2000), url: url ? String(url) : undefined }
}

export const articleText = (a: Article) => `${a.title}. ${a.body.slice(0, 500)}`

/** Help Center API URL for a subdomain or a full host (custom domains work too). */
export function helpCenterUrl(input: string, locale = ''): string {
  let host = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host.includes('.')) host = `${host}.zendesk.com`
  return `https://${host}/api/v2/help_center/${locale ? locale + '/' : ''}articles.json?per_page=100`
}

export const KB_THRESHOLDS: Record<Embedder, { covered: number; partial: number }> = {
  minilm: { covered: 0.5, partial: 0.36 },
  lexical: { covered: 0.3, partial: 0.18 },
}

export function matchArticles(intents: Intent[], articles: Article[], vectors: Float32Array[], embedder: Embedder): Intent[] {
  const th = KB_THRESHOLDS[embedder]
  return intents.map(it => {
    if (!articles.length) return { ...it, kb: undefined }
    const c = unpackCentroid(it.centroid)
    let best = -1, bs = -Infinity
    vectors.forEach((v, j) => { const s = dot(c, v); if (s > bs) { bs = s; best = j } })
    const a = articles[best]
    const kb: KbMatch = { articleId: a.id, title: a.title, url: a.url, sim: bs, status: bs >= th.covered ? 'covered' : bs >= th.partial ? 'partial' : 'gap' }
    return { ...it, kb }
  })
}
