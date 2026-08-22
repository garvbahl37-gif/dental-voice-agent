import { connect, OrgRepo } from '@vaani/db'
import { requireApiKey } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recent calls, for a practice's own systems.
 *
 * The org comes from the key, never from a parameter — an endpoint that accepts
 * `?orgId=` hands every practice's call history to anyone with any valid key.
 * Transcripts are included because they are the point of the integration, and
 * the key holder is the practice itself.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireApiKey(req)
  if ('error' in auth) return auth.error

  const url = new URL(req.url)
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
  const outcome = url.searchParams.get('outcome') ?? undefined

  const { db } = connect()
  const repo = new OrgRepo(db, auth.caller.orgId)
  const calls = await repo.recentCalls({ limit, outcome })

  return Response.json({
    calls: calls.map((c) => ({
      id: c.id,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationSec: c.durationSec,
      direction: c.direction,
      channel: c.channel,
      from: c.fromNumber,
      to: c.toNumber,
      language: c.language,
      outcome: c.outcome,
      triageBand: c.triageBand,
      transferred: c.transferred,
      patientId: c.patientId,
      transcript: c.transcript,
    })),
  })
}
