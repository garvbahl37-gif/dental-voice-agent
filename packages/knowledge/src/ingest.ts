import { and, eq } from 'drizzle-orm'
import { id, knowledgeChunks, knowledgeDocuments, type Database } from '@vaani/db'
import { chunkText, extractLinks, extractTitle, htmlToText, isWorthCrawling } from './chunk'
import type { Embedder } from './retrieve'

/**
 * Getting a clinic's own words into the agent.
 *
 * Two ways in: paste text, or point at the practice website. The website path
 * is the one a clinic will actually use, because the information already exists
 * there and nobody wants to retype their fee list.
 *
 * The crawler is deliberately small and rude to itself: same host only, a hard
 * page cap, a fixed politeness delay, and a filter that skips blogs and images.
 * A dental site is mostly navigation and stock photography — indexing all of it
 * fills retrieval with noise that then competes with the real answer.
 */

export interface IngestResult {
  documentId: string
  chunks: number
  title: string
}

export interface IngestOptions {
  db: Database
  orgId: string
  embed?: Embedder
}

async function storeChunks(
  db: Database,
  orgId: string,
  documentId: string,
  text: string,
  embed?: Embedder,
): Promise<number> {
  const chunks = chunkText(text)
  if (chunks.length === 0) return 0

  let vectors: number[][] | null = null
  if (embed) {
    try {
      vectors = await embed(chunks.map((c) => c.content))
    } catch {
      // Indexed without vectors rather than not at all: retrieval falls back to
      // lexical, which still answers a question containing the right words.
      vectors = null
    }
  }

  await db.insert(knowledgeChunks).values(
    chunks.map((c, i) => ({
      id: id('chunk'),
      orgId,
      documentId,
      ordinal: c.ordinal,
      content: c.content,
      embedding: vectors?.[i] ?? null,
      tokens: Math.ceil(c.content.length / 4),
    })),
  )
  return chunks.length
}

export async function ingestText(
  opts: IngestOptions,
  input: {
    title: string
    text: string
    sourceType?: 'text' | 'pdf' | 'docx' | 'url' | 'crawl'
    sourceRef?: string
  },
): Promise<IngestResult> {
  const { db, orgId } = opts
  const [doc] = await db
    .insert(knowledgeDocuments)
    .values({
      id: id('doc'),
      orgId,
      title: input.title,
      sourceType: input.sourceType ?? 'text',
      sourceRef: input.sourceRef,
      status: 'pending',
    })
    .returning()

  try {
    const n = await storeChunks(db, orgId, doc!.id, input.text, opts.embed)
    await db
      .update(knowledgeDocuments)
      .set({ status: n > 0 ? 'indexed' : 'failed', chunkCount: n, error: n > 0 ? null : 'no usable text' })
      .where(and(eq(knowledgeDocuments.orgId, orgId), eq(knowledgeDocuments.id, doc!.id)))
    return { documentId: doc!.id, chunks: n, title: input.title }
  } catch (err) {
    await db
      .update(knowledgeDocuments)
      .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : 'failed' })
      .where(and(eq(knowledgeDocuments.orgId, orgId), eq(knowledgeDocuments.id, doc!.id)))
    throw err
  }
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; html: string; contentType?: string }>

export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'VaaniBot/1.0 (+clinic knowledge import)' },
    signal: AbortSignal.timeout(15_000),
  })
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || !contentType.includes('text/html')) return { ok: false, html: '', contentType }
  return { ok: true, html: await res.text(), contentType }
}

export interface CrawlOptions extends IngestOptions {
  fetcher?: Fetcher
  maxPages?: number
  /** Politeness. A clinic's site is usually on shared hosting. */
  delayMs?: number
}

/**
 * Import a practice website.
 *
 * Breadth-first from the homepage, following only same-host links that look
 * like they answer something. Each page becomes its own document, so an answer
 * can be traced back to the page it came from — "we say that on our fees page"
 * is a sentence a practice can check, and a single merged blob is not.
 */
export async function crawlSite(
  opts: CrawlOptions,
  startUrl: string,
): Promise<{ pages: number; chunks: number; documents: IngestResult[]; skipped: string[] }> {
  const fetcher = opts.fetcher ?? httpFetcher
  const maxPages = opts.maxPages ?? 12
  const delay = opts.delayMs ?? 400

  let origin: URL
  try {
    origin = new URL(startUrl)
  } catch {
    throw new Error('That does not look like a web address.')
  }
  if (!/^https?:$/.test(origin.protocol)) throw new Error('Only http and https addresses can be imported.')

  const queue: string[] = [origin.toString()]
  const seen = new Set<string>([origin.toString()])
  const documents: IngestResult[] = []
  const skipped: string[] = []
  let chunks = 0

  while (queue.length > 0 && documents.length < maxPages) {
    const url = queue.shift()!
    let page: Awaited<ReturnType<Fetcher>>
    try {
      page = await fetcher(url)
    } catch {
      skipped.push(url)
      continue
    }
    if (!page.ok || page.html.length < 200) {
      skipped.push(url)
      continue
    }

    const text = htmlToText(page.html)
    if (text.length >= 200) {
      const result = await ingestText(opts, {
        title: extractTitle(page.html, url),
        text,
        sourceType: 'crawl',
        sourceRef: url,
      })
      documents.push(result)
      chunks += result.chunks
    } else {
      skipped.push(url)
    }

    for (const link of extractLinks(page.html, url)) {
      if (seen.has(link) || !isWorthCrawling(link)) continue
      seen.add(link)
      queue.push(link)
    }

    if (delay > 0 && queue.length > 0) await new Promise((r) => setTimeout(r, delay))
  }

  return { pages: documents.length, chunks, documents, skipped }
}

/** Remove a document and everything indexed from it. */
export async function forgetDocument(
  db: Database,
  orgId: string,
  documentId: string,
): Promise<void> {
  await db
    .delete(knowledgeChunks)
    .where(and(eq(knowledgeChunks.orgId, orgId), eq(knowledgeChunks.documentId, documentId)))
  await db
    .delete(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.orgId, orgId), eq(knowledgeDocuments.id, documentId)))
}

export async function listDocuments(db: Database, orgId: string) {
  return db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.orgId, orgId))
    .orderBy(knowledgeDocuments.createdAt)
}

/**
 * Gemini embeddings, batched.
 *
 * 768 dimensions to match the column. Returns nothing on failure rather than
 * throwing, because an embedding outage should degrade retrieval to lexical,
 * not stop a clinic importing its website.
 */
export function geminiEmbedder(apiKey = process.env.GEMINI_API_KEY): Embedder {
  return async (texts) => {
    if (!apiKey || texts.length === 0) return []
    const out: number[][] = []
    // Batched, because a fee list is a few hundred chunks and one request each
    // would take minutes and trip rate limits.
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100)
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text }] },
              outputDimensionality: 768,
            })),
          }),
          signal: AbortSignal.timeout(30_000),
        },
      )
      if (!res.ok) throw new Error(`embedding failed (${res.status})`)
      const body = (await res.json()) as { embeddings?: Array<{ values: number[] }> }
      for (const e of body.embeddings ?? []) out.push(e.values)
    }
    return out
  }
}
