/**
 * Turning a clinic's documents into things the agent can quote.
 *
 * The unit that matters here is *an answer a receptionist could give*. A fixed
 * 512-token window cuts a fee table in half and leaves the agent quoting a
 * price with no treatment attached — which is worse than not answering at all,
 * because it sounds confident.
 *
 * So chunks are built from the document's own structure: headings start new
 * chunks, list items and table rows stay whole, and a heading is carried into
 * every chunk beneath it so "₹6,000 to ₹12,000" is never stranded from "Root
 * Canal".
 */

export interface Chunk {
  content: string
  ordinal: number
  /** The heading path this text sits under, for citation and for context. */
  heading?: string
}

const MAX_CHARS = 1200
const MIN_CHARS = 120

/** Strip markup without losing the block structure that carries meaning. */
export function htmlToText(html: string): string {
  return (
    html
      // Whole regions that never contain an answer.
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Block boundaries become newlines, so paragraphs do not run together.
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      // Table cells become separators, so a fee row stays readable as a row.
      .replace(/<\/t[dh]>/gi, ' · ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&#8377;|&rupee;/gi, '₹')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim()
  )
}

/** Headings in markdown, or a short line that looks like one. */
function isHeading(line: string): boolean {
  if (/^#{1,6}\s/.test(line)) return true
  if (line.length > 70) return false
  // "Root Canal Treatment" / "FEES" — title case or caps, and no sentence end.
  return /^[A-Z][^.!?]*$/.test(line) && line.split(/\s+/).length <= 8 && line.length > 2
}

function cleanHeading(line: string): string {
  return line.replace(/^#{1,6}\s*/, '').trim()
}

export function chunkText(input: string): Chunk[] {
  const text = input.replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const lines = text.split('\n')
  const chunks: Chunk[] = []
  let heading: string | undefined
  let buffer: string[] = []

  const flush = () => {
    const body = buffer.join('\n').trim()
    buffer = []
    if (!body) return
    // The heading rides along, so a price is never separated from its treatment.
    const content = heading && !body.startsWith(heading) ? `${heading}\n${body}` : body
    chunks.push({ content, ordinal: chunks.length, heading })
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (buffer.join('\n').length >= MAX_CHARS) flush()
      continue
    }

    if (isHeading(line)) {
      flush()
      heading = cleanHeading(line)
      continue
    }

    // Splitting mid-row turns a fee table into two useless halves.
    if (buffer.join('\n').length + line.length > MAX_CHARS && buffer.length > 0) flush()
    buffer.push(line)
  }
  flush()

  /**
   * Fold stranded fragments back into what preceded them — but only fragments.
   *
   * A short section that has its own heading is a whole answer, not a leftover:
   * "Cancellation — we ask for 24 hours notice" is brief and complete. Merging
   * it into the section above put the cancellation policy inside the chunk
   * about root canal fees, so a question about one retrieved the other.
   */
  const merged: Chunk[] = []
  for (const c of chunks) {
    const prev = merged[merged.length - 1]
    const isContinuation = !c.heading || c.heading === prev?.heading
    if (
      prev &&
      isContinuation &&
      c.content.length < MIN_CHARS &&
      prev.content.length + c.content.length < MAX_CHARS
    ) {
      prev.content = `${prev.content}\n${c.content}`
      continue
    }
    merged.push({ ...c, ordinal: merged.length })
  }
  return merged
}

/**
 * Which pages of a clinic site are worth reading.
 *
 * A dental site is mostly navigation, blog posts and stock photography. The
 * pages that answer a caller's question are a small, predictable set, and
 * crawling everything mostly fills the index with noise that then competes with
 * the real answer at retrieval time.
 */
const WORTH_READING =
  /(service|treatment|price|pricing|fee|cost|faq|question|about|team|doctor|dentist|contact|hour|timing|location|branch|insurance|policy|cancel)/i

const NEVER =
  /(\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4|css|js)(\?|$)|\/(blog|news|tag|category|author|wp-|feed|cart|checkout|login|privacy-policy-generator))/i

export function isWorthCrawling(url: string): boolean {
  if (NEVER.test(url)) return false
  try {
    const u = new URL(url)
    if (u.pathname === '/' || u.pathname === '') return true
    return WORTH_READING.test(u.pathname)
  } catch {
    return false
  }
}

/** Same-site links only — a crawler that wanders onto Facebook is a bug. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1]!
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    try {
      const u = new URL(href, base)
      if (u.hostname !== base.hostname) continue
      u.hash = ''
      out.add(u.toString())
    } catch {
      /* not a usable link */
    }
  }
  return [...out]
}

/** The page title, for citation — "we say that on our fees page". */
export function extractTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const t = m?.[1]?.trim()
  return t && t.length > 0 ? t.slice(0, 200) : fallback
}
