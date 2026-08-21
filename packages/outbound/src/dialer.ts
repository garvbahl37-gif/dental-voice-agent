import { and, eq, inArray, lte, or, sql } from 'drizzle-orm'
import {
  OrgRepo,
  campaignTargets,
  campaigns,
  patients,
  type Database,
} from '@vaani/db'
import { backoffFor, mayDial, type RefusalReason } from './policy'
import { outboundGreeting, outboundPrompt, type OutboundContext } from './prompts'
import type { CampaignKind } from './campaigns'

/**
 * The dialler.
 *
 * Deliberately a *claim-then-dial* loop rather than a fan-out: it takes one
 * target at a time, marks it `calling` before placing the call, and releases it
 * on failure. Two workers, or one worker restarted mid-run, must never both
 * ring the same patient — and a patient rung twice by a machine in ten minutes
 * is the failure that gets a practice to switch the whole product off.
 *
 * Placing the call is injected. The dialler's job is deciding *whether* and
 * *whom*; how a call reaches the network is Twilio's business, and keeping the
 * two apart is what makes this testable without dialling anyone.
 */

export interface PlaceCallInput {
  to: string
  from: string
  callId: string
  orgId: string
  campaignKind: CampaignKind
  greeting: string
  systemPrompt: string
}

export interface PlacedCall {
  externalId: string
}

export type PlaceCall = (input: PlaceCallInput) => Promise<PlacedCall>

export interface DialerOptions {
  db: Database
  orgId: string
  placeCall: PlaceCall
  /** The practice's own number, shown as caller ID. */
  fromNumber: string
  now?: () => Date
  /** How many to dial in one pass. Small — this is a clinic, not a call centre. */
  batchSize?: number
}

export interface DialOutcome {
  attempted: number
  placed: number
  skipped: Partial<Record<RefusalReason, number>>
}

export async function runDialer(opts: DialerOptions): Promise<DialOutcome> {
  const { db, orgId, placeCall, fromNumber } = opts
  const now = opts.now ?? (() => new Date())
  const batch = opts.batchSize ?? 5

  const repo = new OrgRepo(db, orgId)
  const org = await repo.org()
  if (!org) return { attempted: 0, placed: 0, skipped: {} }

  const branches = await repo.branches()
  const services = await repo.services()

  const due = await db
    .select({
      target: campaignTargets,
      campaign: campaigns,
      patient: patients,
    })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(patients, eq(patients.id, campaignTargets.patientId))
    .where(
      and(
        eq(campaignTargets.orgId, orgId),
        eq(campaignTargets.status, 'queued'),
        or(
          sql`${campaignTargets.nextAttemptAt} is null`,
          lte(campaignTargets.nextAttemptAt, now()),
        ),
      ),
    )
    .limit(batch)

  const outcome: DialOutcome = { attempted: 0, placed: 0, skipped: {} }

  for (const row of due) {
    outcome.attempted += 1

    const check = mayDial({
      subject: {
        phone: row.patient.phone,
        doNotContact: row.patient.doNotContact,
        consentCall: row.patient.consentCall,
      },
      campaign: {
        status: row.campaign.status,
        windowStart: row.campaign.windowStart,
        windowEnd: row.campaign.windowEnd,
        maxAttempts: row.campaign.maxAttempts,
      },
      state: { attempts: row.target.attempts, lastCalledAt: row.target.lastAttemptAt },
      timezone: org.timezone,
      now: now(),
    })

    if (!check.allowed) {
      const reason = check.reason!
      outcome.skipped[reason] = (outcome.skipped[reason] ?? 0) + 1
      await db
        .update(campaignTargets)
        .set(
          // A timing refusal is a wait; anything else is final, and leaving it
          // queued would mean re-evaluating a settled decision forever.
          check.retryAt
            ? { nextAttemptAt: check.retryAt }
            : { status: 'skipped', result: reason },
        )
        .where(and(eq(campaignTargets.orgId, orgId), eq(campaignTargets.id, row.target.id)))
      continue
    }

    // Claimed before the call is placed. A crash between here and the dial
    // leaves it stuck rather than dialled twice, and stuck is the safe failure.
    const claimed = await db
      .update(campaignTargets)
      .set({ status: 'calling', attempts: row.target.attempts + 1, lastAttemptAt: now() })
      .where(
        and(
          eq(campaignTargets.orgId, orgId),
          eq(campaignTargets.id, row.target.id),
          eq(campaignTargets.status, 'queued'),
        ),
      )
      .returning({ id: campaignTargets.id })
    if (claimed.length === 0) continue // another worker got there first

    const branch = branches.find((b) => b.id === row.patient.preferredBranchId) ?? branches[0]
    const appointment = row.target.appointmentId
      ? (await repo.appointmentsFor(row.patient.id)).find((a) => a.id === row.target.appointmentId)
      : undefined

    const ctx: OutboundContext = {
      practiceName: org.name,
      patientName: row.patient.name.split(' ')[0],
      branchName: branch?.name,
      branchPhone: branch?.emergencyPhone ?? branch?.phone ?? undefined,
      appointmentWhen: appointment
        ? appointment.startAt.toLocaleString('en-IN', { timeZone: org.timezone })
        : undefined,
      treatment: appointment
        ? services.find((s) => s.id === appointment.serviceId)?.name
        : undefined,
    }
    const kind = row.campaign.kind as CampaignKind

    const call = await repo.startCall({
      channel: 'twilio',
      direction: 'outbound',
      toNumber: row.patient.phone,
      fromNumber,
      patientId: row.patient.id,
      branchId: branch?.id,
    })

    try {
      const placed = await placeCall({
        to: row.patient.phone,
        from: fromNumber,
        callId: call.id,
        orgId,
        campaignKind: kind,
        greeting: outboundGreeting(kind, ctx),
        systemPrompt: outboundPrompt(kind, ctx),
      })
      await repo.finishCall(call.id, { externalId: placed.externalId } as never)
      await db
        .update(campaignTargets)
        .set({ status: 'done', lastCallId: call.id, result: 'placed' })
        .where(and(eq(campaignTargets.orgId, orgId), eq(campaignTargets.id, row.target.id)))
      await repo.trace(call.id, 'outbound.placed', 0, { campaign: kind })
      outcome.placed += 1
    } catch (err) {
      // Released back to the queue with a long backoff. A carrier that refused
      // once will usually refuse again immediately.
      const attempts = row.target.attempts + 1
      await db
        .update(campaignTargets)
        .set({
          status: attempts >= row.campaign.maxAttempts ? 'failed' : 'queued',
          nextAttemptAt: new Date(now().getTime() + backoffFor(attempts)),
          result: err instanceof Error ? err.message.slice(0, 120) : 'dial failed',
        })
        .where(and(eq(campaignTargets.orgId, orgId), eq(campaignTargets.id, row.target.id)))
      await repo.finishCall(call.id, { outcome: 'failed' })
    }
  }

  return outcome
}

/** Release targets stuck in `calling` — a worker died mid-dial. */
export async function releaseStuck(
  db: Database,
  orgId: string,
  olderThanMs = 10 * 60_000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const rows = await db
    .update(campaignTargets)
    .set({ status: 'queued', nextAttemptAt: new Date() })
    .where(
      and(
        eq(campaignTargets.orgId, orgId),
        eq(campaignTargets.status, 'calling'),
        lte(campaignTargets.createdAt, cutoff),
      ),
    )
    .returning({ id: campaignTargets.id })
  return rows.length
}

export async function pauseCampaign(db: Database, orgId: string, kind: CampaignKind): Promise<void> {
  await db
    .update(campaigns)
    .set({ status: 'paused' })
    .where(and(eq(campaigns.orgId, orgId), eq(campaigns.kind, kind)))
}

/** Honour a request never to be rung again. Applies across every campaign. */
export async function recordDoNotContact(
  db: Database,
  orgId: string,
  patientId: string,
): Promise<void> {
  await db
    .update(patients)
    .set({ doNotContact: true })
    .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId)))
  await db
    .update(campaignTargets)
    .set({ status: 'skipped', result: 'do_not_contact' })
    .where(
      and(
        eq(campaignTargets.orgId, orgId),
        eq(campaignTargets.patientId, patientId),
        inArray(campaignTargets.status, ['queued', 'calling']),
      ),
    )
}
