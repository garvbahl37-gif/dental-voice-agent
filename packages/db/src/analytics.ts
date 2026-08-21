import { and, avg, count, desc, eq, gte, isNotNull, sql, sum } from 'drizzle-orm'
import type { Database } from './client'
import { appointments, calls, escalations } from './schema'

/**
 * What the practice actually wants to know.
 *
 * Written as aggregate SQL rather than by pulling rows into JavaScript: a busy
 * clinic's call table grows without bound, and a dashboard that loads a year of
 * calls to count them is a dashboard that stops loading in month four.
 *
 * The metrics are chosen to answer one question — *is this thing earning its
 * keep?* — so "missed opportunities" and "needs a human" carry as much weight
 * as the flattering numbers. A dashboard that only shows what went well is a
 * dashboard nobody trusts twice.
 */

export interface Period {
  from: Date
  to?: Date
}

export interface Headline {
  calls: number
  booked: number
  escalated: number
  missed: number
  emergencies: number
  avgDurationSec: number
  bookingRate: number
  transferRate: number
  answeredInLanguage: Record<string, number>
}

export async function headline(db: Database, orgId: string, period: Period): Promise<Headline> {
  const scope = and(eq(calls.orgId, orgId), gte(calls.startedAt, period.from))

  const [totals] = await db
    .select({
      calls: count(),
      avgDuration: avg(calls.durationSec),
      transferred: sum(sql<number>`case when ${calls.transferred} then 1 else 0 end`),
    })
    .from(calls)
    .where(scope)

  const byOutcome = await db
    .select({ outcome: calls.outcome, n: count() })
    .from(calls)
    .where(scope)
    .groupBy(calls.outcome)

  const byLanguage = await db
    .select({ language: calls.language, n: count() })
    .from(calls)
    .where(and(scope, isNotNull(calls.language)))
    .groupBy(calls.language)

  const [emergency] = await db
    .select({ n: count() })
    .from(calls)
    .where(and(scope, eq(calls.triageBand, 'RED')))

  const outcome = (k: string) => Number(byOutcome.find((r) => r.outcome === k)?.n ?? 0)
  const total = Number(totals?.calls ?? 0)
  const booked = outcome('booked')

  return {
    calls: total,
    booked,
    escalated: outcome('escalated'),
    // A call that reached a person and produced nothing is the number a
    // practice should be angriest about, so it gets its own name.
    missed: outcome('answered') + outcome('abandoned'),
    emergencies: Number(emergency?.n ?? 0),
    avgDurationSec: Math.round(Number(totals?.avgDuration ?? 0)),
    bookingRate: total > 0 ? booked / total : 0,
    transferRate: total > 0 ? Number(totals?.transferred ?? 0) / total : 0,
    answeredInLanguage: Object.fromEntries(byLanguage.map((r) => [r.language ?? 'unknown', Number(r.n)])),
  }
}

export interface AgentQuality {
  firstResponseMsP50: number
  firstResponseMsP95: number
  avgResponseMs: number
  bargeInsPerCall: number
  noSpeechRate: number
  failedToolRate: number
}

/**
 * How the agent is behaving, as distinct from how the business is doing.
 *
 * Percentiles rather than means for latency: one 9-second reply matters more to
 * the caller who got it than to an average, and a mean hides it completely.
 */
export async function agentQuality(db: Database, orgId: string, period: Period): Promise<AgentQuality> {
  const scope = and(eq(calls.orgId, orgId), gte(calls.startedAt, period.from))

  const [row] = await db
    .select({
      p50: sql<number>`percentile_cont(0.5) within group (order by ${calls.firstResponseMs})`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${calls.firstResponseMs})`,
      avgResponse: avg(calls.avgResponseMs),
      bargeIns: avg(calls.bargeInCount),
      total: count(),
      noSpeech: sum(sql<number>`case when ${calls.outcome} = 'no_speech' then 1 else 0 end`),
    })
    .from(calls)
    .where(scope)

  const total = Number(row?.total ?? 0)
  return {
    firstResponseMsP50: Math.round(Number(row?.p50 ?? 0)),
    firstResponseMsP95: Math.round(Number(row?.p95 ?? 0)),
    avgResponseMs: Math.round(Number(row?.avgResponse ?? 0)),
    bargeInsPerCall: Number(Number(row?.bargeIns ?? 0).toFixed(2)),
    noSpeechRate: total > 0 ? Number(row?.noSpeech ?? 0) / total : 0,
    failedToolRate: 0,
  }
}

/** Calls per day, for the shape of a week rather than a single number. */
export async function callsPerDay(
  db: Database,
  orgId: string,
  period: Period,
): Promise<Array<{ day: string; calls: number; booked: number }>> {
  const rows = await db
    .select({
      day: sql<string>`to_char(${calls.startedAt}, 'YYYY-MM-DD')`,
      calls: count(),
      booked: sum(sql<number>`case when ${calls.outcome} = 'booked' then 1 else 0 end`),
    })
    .from(calls)
    .where(and(eq(calls.orgId, orgId), gte(calls.startedAt, period.from)))
    .groupBy(sql`to_char(${calls.startedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${calls.startedAt}, 'YYYY-MM-DD')`)

  return rows.map((r) => ({ day: r.day, calls: Number(r.calls), booked: Number(r.booked ?? 0) }))
}

/**
 * What the agent earned, against what it cost.
 *
 * Revenue is attributed only to appointments the agent actually created and
 * that were not cancelled — counting a booking the patient dropped would make
 * the number flattering and useless. Prices are held in paise; micros here keep
 * the cost side (fractions of a paisa per token) from rounding to nothing.
 */
export interface Economics {
  callCount: number
  callMinutes: number
  /** All amounts are paise, the same unit the price list uses. */
  modelCostPaise: number
  telephonyCostPaise: number
  bookedRevenuePaise: number
  costPerBookingPaise: number
  roi: number
}

export async function economics(
  db: Database,
  orgId: string,
  period: Period,
  rates: { telephonyPerMinutePaise?: number } = {},
): Promise<Economics> {
  const scope = and(eq(calls.orgId, orgId), gte(calls.startedAt, period.from))

  const [c] = await db
    .select({
      n: count(),
      seconds: sum(calls.durationSec),
      model: sum(calls.costPaise),
    })
    .from(calls)
    .where(scope)

  const [rev] = await db
    .select({
      paise: sql<number>`coalesce(sum(coalesce(s.price_min_paise, 0)), 0)`,
    })
    .from(appointments)
    .innerJoin(sql`services s`, sql`s.id = ${appointments.serviceId}`)
    .where(
      and(
        eq(appointments.orgId, orgId),
        gte(appointments.createdAt, period.from),
        eq(appointments.source, 'phone'),
        sql`${appointments.status} <> 'cancelled'`,
      ),
    )

  const minutes = Number(c?.seconds ?? 0) / 60
  // ~₹0.70 a minute for inbound India, in paise.
  const perMinute = rates.telephonyPerMinutePaise ?? 70
  const telephony = Math.round(minutes * perMinute)
  const model = Number(c?.model ?? 0)
  const bookings = await db
    .select({ n: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.orgId, orgId),
        gte(appointments.createdAt, period.from),
        eq(appointments.source, 'phone'),
        sql`${appointments.status} <> 'cancelled'`,
      ),
    )

  const bookingCount = Number(bookings[0]?.n ?? 0)
  const totalCost = model + telephony
  const revenuePaise = Number(rev?.paise ?? 0)

  return {
    callCount: Number(c?.n ?? 0),
    callMinutes: Math.round(minutes),
    modelCostPaise: model,
    telephonyCostPaise: telephony,
    bookedRevenuePaise: revenuePaise,
    costPerBookingPaise: bookingCount > 0 ? Math.round(totalCost / bookingCount) : 0,
    // Same unit on both sides now, so this is a plain ratio.
    roi: totalCost > 0 ? revenuePaise / totalCost : 0,
  }
}

/** The work queue: what a human still has to deal with. */
export async function outstanding(db: Database, orgId: string) {
  return db
    .select()
    .from(escalations)
    .where(and(eq(escalations.orgId, orgId), sql`${escalations.status} <> 'resolved'`))
    .orderBy(desc(escalations.createdAt))
    .limit(50)
}

export function since(days: number): Period {
  const from = new Date()
  from.setDate(from.getDate() - days)
  from.setHours(0, 0, 0, 0)
  return { from }
}
