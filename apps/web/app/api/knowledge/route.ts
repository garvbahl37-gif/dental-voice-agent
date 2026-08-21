import { connect } from '@vaani/db'
import { crawlSite, forgetDocument, geminiEmbedder, ingestText, listDocuments } from '@vaani/knowledge'
import { requireUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A site import fetches a dozen pages with a politeness delay between them.
export const maxDuration = 300

export async function GET(): Promise<Response> {
  const auth = await requireUser('viewer')
  if ('error' in auth) return auth.error
  const { db } = connect()
  const docs = await listDocuments(db, auth.user.orgId)
  return Response.json({
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      sourceType: d.sourceType,
      sourceRef: d.sourceRef,
      status: d.status,
      chunkCount: d.chunkCount,
      error: d.error,
      createdAt: d.createdAt,
    })),
  })
}

/**
 * Import knowledge — pasted text, or a whole practice website.
 *
 * Admin-only. Knowledge is what the agent will read out to patients as the
 * practice's own words, so adding to it is a more consequential act than
 * reading the dashboard.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error

  let body: { url?: string; title?: string; text?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 })
  }

  const { db } = connect()
  const opts = { db, orgId: auth.user.orgId, embed: geminiEmbedder() }

  try {
    if (body.url) {
      const out = await crawlSite(opts, body.url.trim())
      if (out.pages === 0) {
        return Response.json(
          { error: 'Nothing readable was found at that address. Check it opens in a browser.' },
          { status: 422 },
        )
      }
      return Response.json({ imported: out.pages, chunks: out.chunks, skipped: out.skipped.length })
    }

    if (body.text?.trim()) {
      const out = await ingestText(opts, {
        title: body.title?.trim() || 'Pasted notes',
        text: body.text,
      })
      if (out.chunks === 0) {
        return Response.json({ error: 'That text had nothing usable in it.' }, { status: 422 })
      }
      return Response.json({ imported: 1, chunks: out.chunks })
    }

    return Response.json({ error: 'Give either a web address or some text.' }, { status: 400 })
  } catch (err) {
    // The message is the user's — a crawl failure is usually a typo in the URL.
    return Response.json(
      { error: err instanceof Error ? err.message : 'The import failed.' },
      { status: 422 },
    )
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error
  const documentId = new URL(req.url).searchParams.get('id')
  if (!documentId) return Response.json({ error: 'Which document?' }, { status: 400 })

  const { db } = connect()
  // Scoped by org inside, so another practice's document is simply not found.
  await forgetDocument(db, auth.user.orgId, documentId)
  return Response.json({ ok: true })
}
