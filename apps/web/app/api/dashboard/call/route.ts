import { connect, OrgRepo } from '@vaani/db'
import { requireUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One call, with its full trace.
 *
 * The trace is what makes "why did that call go wrong" answerable after the
 * fact rather than reconstructed from a transcript and a guess.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser('receptionist')
  if ('error' in auth) return auth.error

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'A call id is required.' }, { status: 400 })

  const { db } = connect()
  const repo = new OrgRepo(db, auth.user.orgId)
  const call = await repo.call(id)
  // Scoped by the repo, so a call belonging to another practice is simply
  // not found rather than forbidden — which also avoids confirming it exists.
  if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

  return Response.json({ call, trace: await repo.callTrace(id) })
}
