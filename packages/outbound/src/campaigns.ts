import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from 'drizzle-orm'
import {
  appointments,
  calls,
  campaignTargets,
  campaigns,
  id,
  patients,
  services,
  waitlist,
  type Database,
} from '@vaani/db'

/**
 * Who each campaign should ring, and why.
 *
 * Written as queries rather than as a nightly export, because the population is
 * defined by what is true right now: a reminder for tomorrow is wrong if the
 * patient cancelled this morning.
 *
 * Every builder is *conservative about who it includes*. The cost of missing
 * someone is a call that does not happen; the cost of including someone wrongly
 * is a clinic ringing a patient about an appointment they already cancelled, or
 * a bereaved family being asked to book a cleaning. Those are not symmetric, so
 * the filters below exclude on doubt.
 */

export type CampaignKind = 'reminder' | 'recall' | 'waitlist' | 'missed_call' | 'followup'

export interface BuildResult {
  campaignId: string
  queued: number
  skipped: number
}

/** Only people who may be called at all. Policy re-checks at dial time. */
const CONTACTABLE = (orgId: string) =>
  and(
    eq(patients.orgId, orgId),
    eq(patients.doNotContact, false),
    eq(patients.consentCall, true),
    ne(patients.phone, ''),
  )

async function ensureCampaign(
  db: Database,
  orgId: string,
  kind: CampaignKind,
  name: string,
  config: Record<string, unknown> = {},
): Promise<string> {
  const [existing] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.orgId, orgId), eq(campaigns.kind, kind)))
    .limit(1)
  if (existing) return existing.id

  const [row] = await db
    .insert(campaigns)
    .values({ id: id('camp'), orgId, name, kind, status: 'active', config })
    .returning({ id: campaigns.id })
  return row!.id
}

/** Already queued or in flight for this campaign — never queue twice. */
async function alreadyTargeted(db: Database, orgId: string, campaignId: string): Promise<Set<string>> {
  const rows = await db
    .select({ patientId: campaignTargets.patientId, appointmentId: campaignTargets.appointmentId })
    .from(campaignTargets)
    .where(
      and(
        eq(campaignTargets.orgId, orgId),
        eq(campaignTargets.campaignId, campaignId),
        inArray(campaignTargets.status, ['queued', 'calling', 'done']),
      ),
    )
  return new Set(rows.map((r) => r.appointmentId ?? r.patientId))
}

/**
 * Appointment reminders.
 *
 * Only for appointments still standing, and only once — `reminderSentAt` is the
 * guard, so a builder that runs hourly does not ring the same patient hourly.
 */
export async function buildReminders(
  db: Database,
  orgId: string,
  opts: { hoursAhead?: number; now?: Date } = {},
): Promise<BuildResult> {
  const now = opts.now ?? new Date()
  const horizon = new Date(now.getTime() + (opts.hoursAhead ?? 26) * 3600_000)
  const campaignId = await ensureCampaign(db, orgId, 'reminder', 'Appointment reminders')
  const seen = await alreadyTargeted(db, orgId, campaignId)

  const due = await db
    .select({
      appointmentId: appointments.id,
      patientId: appointments.patientId,
      startAt: appointments.startAt,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        eq(appointments.orgId, orgId),
        inArray(appointments.status, ['booked', 'confirmed']),
        gte(appointments.startAt, now),
        lte(appointments.startAt, horizon),
        isNull(appointments.reminderSentAt),
        CONTACTABLE(orgId),
      ),
    )

  let queued = 0
  for (const row of due) {
    if (seen.has(row.appointmentId)) continue
    await db.insert(campaignTargets).values({
      id: id('tgt'),
      orgId,
      campaignId,
      patientId: row.patientId,
      appointmentId: row.appointmentId,
      nextAttemptAt: now,
    })
    // Marked here rather than after the call: a crash mid-campaign should
    // under-remind, never double-remind.
    await db
      .update(appointments)
      .set({ reminderSentAt: now })
      .where(and(eq(appointments.orgId, orgId), eq(appointments.id, row.appointmentId)))
    queued += 1
  }
  return { campaignId, queued, skipped: due.length - queued }
}

/**
 * Recall — patients overdue for a treatment with a recall interval.
 *
 * Excludes anyone who already has a future appointment, because ringing a
 * patient to book a cleaning they booked last week is the single fastest way to
 * make a practice switch this off.
 */
export async function buildRecall(
  db: Database,
  orgId: string,
  opts: { now?: Date; limit?: number } = {},
): Promise<BuildResult> {
  const now = opts.now ?? new Date()
  const campaignId = await ensureCampaign(db, orgId, 'recall', 'Recall — overdue check-ups')
  const seen = await alreadyTargeted(db, orgId, campaignId)

  const withFuture = db
    .select({ patientId: appointments.patientId })
    .from(appointments)
    .where(
      and(
        eq(appointments.orgId, orgId),
        inArray(appointments.status, ['booked', 'confirmed']),
        gte(appointments.startAt, now),
      ),
    )

  const overdue = await db
    .select({
      patientId: appointments.patientId,
      serviceId: appointments.serviceId,
      lastVisit: sql<string>`max(${appointments.startAt})`,
      recallDays: services.recallDays,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        eq(appointments.orgId, orgId),
        eq(appointments.status, 'completed'),
        sql`${services.recallDays} is not null`,
        notInArray(appointments.patientId, withFuture),
        CONTACTABLE(orgId),
      ),
    )
    .groupBy(appointments.patientId, appointments.serviceId, services.recallDays)
    .having(
      sql`max(${appointments.startAt}) < now() - (${services.recallDays} || ' days')::interval`,
    )
    .limit(opts.limit ?? 100)

  let queued = 0
  for (const row of overdue) {
    if (seen.has(row.patientId)) continue
    await db.insert(campaignTargets).values({
      id: id('tgt'),
      orgId,
      campaignId,
      patientId: row.patientId,
      nextAttemptAt: now,
    })
    queued += 1
  }
  return { campaignId, queued, skipped: overdue.length - queued }
}

/**
 * A slot came free — offer it to the waitlist.
 *
 * Highest priority first, then longest waiting. Deliberately offers to a few
 * people rather than one: a single offer that goes unanswered leaves the chair
 * empty, which is the outcome the waitlist exists to prevent.
 */
export async function buildWaitlistOffers(
  db: Database,
  orgId: string,
  opts: { serviceId?: string; branchId?: string; offerTo?: number; now?: Date } = {},
): Promise<BuildResult> {
  const now = opts.now ?? new Date()
  const campaignId = await ensureCampaign(db, orgId, 'waitlist', 'Waitlist — a slot came free')
  const seen = await alreadyTargeted(db, orgId, campaignId)

  const conds = [eq(waitlist.orgId, orgId), eq(waitlist.status, 'waiting')]
  if (opts.serviceId) conds.push(eq(waitlist.serviceId, opts.serviceId))
  if (opts.branchId) conds.push(eq(waitlist.branchId, opts.branchId))

  const candidates = await db
    .select({ id: waitlist.id, patientId: waitlist.patientId })
    .from(waitlist)
    .innerJoin(patients, eq(patients.id, waitlist.patientId))
    .where(and(...conds, CONTACTABLE(orgId)))
    .orderBy(desc(waitlist.priority), waitlist.createdAt)
    .limit(opts.offerTo ?? 3)

  let queued = 0
  for (const row of candidates) {
    if (seen.has(row.patientId)) continue
    await db.insert(campaignTargets).values({
      id: id('tgt'),
      orgId,
      campaignId,
      patientId: row.patientId,
      nextAttemptAt: now,
    })
    await db
      .update(waitlist)
      .set({ status: 'offered', lastOfferedAt: now })
      .where(and(eq(waitlist.orgId, orgId), eq(waitlist.id, row.id)))
    queued += 1
  }
  return { campaignId, queued, skipped: candidates.length - queued }
}

/**
 * Someone rang and got nothing useful.
 *
 * The highest-intent population there is: they picked up the phone to a dentist
 * and left without an appointment. Restricted to recent calls, because ringing
 * back about a call from three weeks ago is a cold call wearing a follow-up's
 * clothes.
 */
export async function buildMissedCallRecovery(
  db: Database,
  orgId: string,
  opts: { withinHours?: number; now?: Date } = {},
): Promise<BuildResult> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - (opts.withinHours ?? 24) * 3600_000)
  const campaignId = await ensureCampaign(db, orgId, 'missed_call', 'Missed-call recovery')
  const seen = await alreadyTargeted(db, orgId, campaignId)

  const missed = await db
    .select({ patientId: calls.patientId, callId: calls.id })
    .from(calls)
    .innerJoin(patients, eq(patients.id, calls.patientId))
    .where(
      and(
        eq(calls.orgId, orgId),
        eq(calls.direction, 'inbound'),
        gte(calls.startedAt, since),
        lt(calls.startedAt, now),
        inArray(calls.outcome, ['abandoned', 'failed', 'no_speech']),
        CONTACTABLE(orgId),
      ),
    )
    .limit(50)

  let queued = 0
  for (const row of missed) {
    if (!row.patientId || seen.has(row.patientId)) continue
    await db.insert(campaignTargets).values({
      id: id('tgt'),
      orgId,
      campaignId,
      patientId: row.patientId,
      nextAttemptAt: now,
    })
    queued += 1
  }
  return { campaignId, queued, skipped: missed.length - queued }
}

/**
 * After a procedure — how are they feeling?
 *
 * The one campaign that must never drift into clinical advice, so the prompt it
 * carries is the narrowest of the set: ask, listen, and escalate anything that
 * sounds wrong to a human. It does not reassure and it does not diagnose.
 */
export async function buildFollowUps(
  db: Database,
  orgId: string,
  opts: { afterHours?: number; now?: Date } = {},
): Promise<BuildResult> {
  const now = opts.now ?? new Date()
  const from = new Date(now.getTime() - (opts.afterHours ?? 48) * 3600_000)
  const to = new Date(now.getTime() - (opts.afterHours ?? 48) * 3600_000 + 24 * 3600_000)
  const campaignId = await ensureCampaign(db, orgId, 'followup', 'Post-treatment follow-up')
  const seen = await alreadyTargeted(db, orgId, campaignId)

  const done = await db
    .select({ patientId: appointments.patientId, appointmentId: appointments.id })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        eq(appointments.orgId, orgId),
        eq(appointments.status, 'completed'),
        gte(appointments.startAt, from),
        lt(appointments.startAt, to),
        CONTACTABLE(orgId),
      ),
    )
    .limit(50)

  let queued = 0
  for (const row of done) {
    if (seen.has(row.appointmentId)) continue
    await db.insert(campaignTargets).values({
      id: id('tgt'),
      orgId,
      campaignId,
      patientId: row.patientId,
      appointmentId: row.appointmentId,
      nextAttemptAt: now,
    })
    queued += 1
  }
  return { campaignId, queued, skipped: done.length - queued }
}

export const BUILDERS = {
  reminder: buildReminders,
  recall: buildRecall,
  waitlist: buildWaitlistOffers,
  missed_call: buildMissedCallRecovery,
  followup: buildFollowUps,
} as const
