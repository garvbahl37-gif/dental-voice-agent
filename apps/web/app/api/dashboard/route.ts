import { connect, OrgRepo, agentQuality, callsPerDay, economics, headline, outstanding, since } from '@vaani/db'
import { requireUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Everything the dashboard shows, in one request.
 *
 * A page that fires eight parallel requests for eight tiles is eight chances to
 * render half a picture. The org comes from the session — there is no way to
 * ask this endpoint about a practice you are not signed in to.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser('viewer')
  if ('error' in auth) return auth.error
  const { user } = auth

  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 7)))
  const period = since(days)

  const { db } = connect()
  const repo = new OrgRepo(db, user.orgId)

  const [org, stats, quality, series, money, queue, recent] = await Promise.all([
    repo.org(),
    headline(db, user.orgId, period),
    agentQuality(db, user.orgId, period),
    callsPerDay(db, user.orgId, period),
    economics(db, user.orgId, period),
    outstanding(db, user.orgId),
    repo.recentCalls({ limit: 25 }),
  ])

  return Response.json({
    org: { name: org?.name, timezone: org?.timezone, plan: org?.plan },
    me: { name: user.name, role: user.role },
    days,
    stats,
    quality,
    series,
    money,
    outstanding: queue.map((e) => ({
      id: e.id,
      reason: e.reason,
      urgency: e.urgency,
      createdAt: e.createdAt,
      brief: e.brief,
    })),
    recent: recent.map((c) => ({
      id: c.id,
      startedAt: c.startedAt,
      durationSec: c.durationSec,
      channel: c.channel,
      direction: c.direction,
      fromNumber: c.fromNumber,
      language: c.language,
      outcome: c.outcome,
      triageBand: c.triageBand,
    })),
  })
}
