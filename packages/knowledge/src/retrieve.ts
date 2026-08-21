import { and, eq, sql } from 'drizzle-orm'
import { knowledgeChunks, knowledgeDocuments, type Database } from '@vaani/db'

/**
 * Finding the passage that answers the question.
 *
 * **Hybrid, not purely semantic.** Embeddings are good at "what are your
 * opening times" matching "hours", and bad at exact tokens — a caller asking
 * about "Invisalign" or "₹6,000" wants the chunk containing that literal
 * string, and a nearest-neighbour search will cheerfully return a
 * similar-sounding passage about a different treatment. Lexical scoring catches
 * those; the vector catches paraphrase. Neither alone is enough.
 *
 * **Retrieval can return nothing, and that is a valid answer.** A score floor
 * means an off-topic question produces no passage rather than the least-bad
 * one, so the agent says it does not know instead of confidently reading out
 * the cancellation policy in response to a question about parking.
 */

export interface Passage {
  chunkId: string
  documentId: string
  documentTitle: string
  sourceRef: string | null
  content: string
  score: number
}

export type Embedder = (texts: string[]) => Promise<number[][]>

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'you', 'your', 'i', 'my', 'me',
  'what', 'when', 'how', 'much', 'can', 'to', 'of', 'for', 'and', 'or', 'in',
  'at', 'it', 'we', 'have', 'has', 'this', 'that', 'with', 'on', 'be',
])

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}₹\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

/**
 * Lexical overlap, weighted towards rarer words.
 *
 * Not full BM25 — at a few thousand chunks per tenant the document-frequency
 * bookkeeping costs more than it buys. What matters is that "Invisalign" counts
 * for far more than "treatment", which length-normalised overlap already gives.
 */
export function lexicalScore(queryTokens: string[], content: string): number {
  if (queryTokens.length === 0) return 0
  const body = tokenise(content)
  if (body.length === 0) return 0
  const bag = new Set(body)

  let hits = 0
  for (const q of queryTokens) {
    if (bag.has(q)) hits += q.length > 6 ? 1.5 : 1
  }
  return hits / queryTokens.length
}

export interface RetrieveOptions {
  db: Database
  orgId: string
  query: string
  embed?: Embedder
  limit?: number
  /** Below this, nothing is returned — silence beats a confident wrong answer. */
  floor?: number
}

export async function retrieve(opts: RetrieveOptions): Promise<Passage[]> {
  const { db, orgId, query } = opts
  const limit = opts.limit ?? 3
  const floor = opts.floor ?? 0.18

  const rows = await db
    .select({
      chunkId: knowledgeChunks.id,
      documentId: knowledgeChunks.documentId,
      content: knowledgeChunks.content,
      embedding: knowledgeChunks.embedding,
      title: knowledgeDocuments.title,
      sourceRef: knowledgeDocuments.sourceRef,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
    .where(
      and(
        eq(knowledgeChunks.orgId, orgId),
        eq(knowledgeDocuments.status, 'indexed'),
      ),
    )

  if (rows.length === 0) return []

  const qTokens = tokenise(query)
  let qVec: number[] | null = null
  if (opts.embed) {
    try {
      qVec = (await opts.embed([query]))[0] ?? null
    } catch {
      // Retrieval degrades to lexical rather than failing the call outright.
      qVec = null
    }
  }

  const scored = rows.map((r) => {
    const lex = lexicalScore(qTokens, r.content)
    const vec = qVec && r.embedding ? cosine(qVec, r.embedding) : 0
    // Weighted toward the vector when one exists, because paraphrase is the
    // common case on the phone — but never so far that an exact term loses.
    const score = qVec && r.embedding ? 0.6 * vec + 0.4 * lex : lex
    return {
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentTitle: r.title,
      sourceRef: r.sourceRef,
      content: r.content,
      score,
    }
  })

  return scored
    .filter((p) => p.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * What gets handed to the model.
 *
 * Numbered and attributed, and followed by an explicit instruction that these
 * passages are the *only* permitted source. Live is fluent enough to answer
 * from its own training data about dentistry in general, which for a question
 * about *this* practice's fees is exactly the failure mode — a confident,
 * plausible, wrong number.
 */
export function asContext(passages: Passage[]): string {
  if (passages.length === 0) {
    return [
      'The practice knowledge base has nothing on this.',
      'Say you do not have that to hand and offer to have someone call back.',
      'Do NOT answer from general knowledge about dentistry.',
    ].join(' ')
  }

  const body = passages
    .map((p, i) => `[${i + 1}] From "${p.documentTitle}":\n${p.content}`)
    .join('\n\n')

  return [
    'Answer ONLY from the passages below. They are this practice’s own words.',
    'If they do not contain the answer, say so and offer a callback — do not fill the gap from general knowledge.',
    '',
    body,
  ].join('\n')
}
