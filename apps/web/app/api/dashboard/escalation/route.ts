import { OrgRepo, connect } from '@vaani/db'
import { requireUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Closing something off.
 *
 * The queue was read-only: a practice could see what needed a human and had no
 * way to say it had been dealt with, so it grew forever and stopped being
 * looked at. Needs receptionist access — a viewer can read the day, not change
 * what it says happened.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser('receptionist')
  if ('error' in auth) return auth.error

  let body: { id?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 })
  }
  if (!body.id) return Response.json({ error: 'Which escalation?' }, { status: 400 })

  const { db } = connect()
  const repo = new OrgRepo(db, auth.user.orgId)
  // Scoped by the repo, so an id from another practice simply does not match.
  const row = await repo.resolveEscalation(body.id, auth.user.id)
  if (!row) return Response.json({ error: 'No such escalation.' }, { status: 404 })

  return Response.json({ ok: true, id: row.id, resolvedAt: row.resolvedAt })
}
