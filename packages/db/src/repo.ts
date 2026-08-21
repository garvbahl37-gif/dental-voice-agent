import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from './client'
import {
  appointments,
  auditLog,
  branches,
  callEvents,
  calls,
  campaignTargets,
  campaigns,
  escalations,
  operatories,
  organizations,
  patients,
  phoneNumbers,
  providers,
  services,
  waitlist,
  type BranchHours,
  type CallTurn,
  type HandoffBrief,
} from './schema'
import {
  findSlots as solveSlots,
  slotStillFree,
  type BusyBlock,
  type Slot,
} from './scheduling'

/**
 * Everything a clinic's data is reached through.
 *
 * The org is a constructor argument, not a parameter, and every query below is
 * built with it already applied. That is deliberate: tenant isolation enforced
 * by remembering to add `WHERE org_id = ?` at each call site fails the first
 * time somebody forgets, and the failure mode is one clinic reading another
 * clinic's patients. There is no method here that can be called without a
 * tenant, and none that can reach across one.
 *
 * `resolveTenant` is the only unscoped query in the package, and it exists
 * because an inbound call arrives knowing nothing but the number it dialled.
 */
export class OrgRepo {
  constructor(
    private readonly db: Database,
    readonly orgId: string,
  ) {}

  // ── Organisation ───────────────────────────────────────────────────────────

  async org() {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, this.orgId))
      .limit(1)
    return row
  }

  async branches() {
    return this.db
      .select()
      .from(branches)
      .where(and(eq(branches.orgId, this.orgId), eq(branches.active, true)))
      .orderBy(asc(branches.name))
  }

  async providers() {
    return this.db
      .select()
      .from(providers)
      .where(and(eq(providers.orgId, this.orgId), eq(providers.active, true)))
      .orderBy(asc(providers.name))
  }

  async services() {
    return this.db
      .select()
      .from(services)
      .where(and(eq(services.orgId, this.orgId), eq(services.active, true)))
      .orderBy(asc(services.name))
  }

  async operatories() {
    return this.db
      .select()
      .from(operatories)
      .where(and(eq(operatories.orgId, this.orgId), eq(operatories.active, true)))
  }

  /**
   * Match what the caller said to a treatment.
   *
   * Callers do not use the price list's vocabulary. "Safai", "cleaning" and
   * "descaling" are one service; so are "cap" and "crown". Longest alias first,
   * so "wisdom tooth surgery" does not match on the substring "tooth".
   */
  async findService(query: string) {
    const all = await this.services()
    const q = query.toLowerCase().trim()
    if (!q) return undefined

    const exact = all.find((s) => s.name.toLowerCase() === q)
    if (exact) return exact

    const byAlias = all
      .flatMap((s) => s.alsoCalled.map((a) => ({ s, a: a.toLowerCase() })))
      .sort((x, y) => y.a.length - x.a.length)
      .find(({ a }) => q === a || q.includes(a))
    if (byAlias) return byAlias.s

    return all.find((s) => q.includes(s.name.toLowerCase()))
  }

  // ── Patients ───────────────────────────────────────────────────────────────

  async findPatientByPhone(phone: string) {
    const digits = normalisePhone(phone)
    if (!digits) return undefined
    const [row] = await this.db
      .select()
      .from(patients)
      .where(and(eq(patients.orgId, this.orgId), eq(patients.phone, digits)))
      .limit(1)
    return row
  }

  async findPatientByName(name: string) {
    const [row] = await this.db
      .select()
      .from(patients)
      .where(
        and(
          eq(patients.orgId, this.orgId),
          sql`lower(${patients.name}) = ${name.toLowerCase().trim()}`,
        ),
      )
      .limit(1)
    return row
  }

  async createPatient(input: {
    name: string
    phone: string
    preferredLanguage?: string
    preferredBranchId?: string
  }) {
    const phone = normalisePhone(input.phone)
    // A second record for the same number splits a patient's history in two and
    // makes every later "I called last week" untrue.
    const existing = await this.findPatientByPhone(phone)
    if (existing) return existing

    const [row] = await this.db
      .insert(patients)
      .values({
        id: id('pat'),
        orgId: this.orgId,
        name: input.name.trim(),
        phone,
        preferredLanguage: input.preferredLanguage,
        preferredBranchId: input.preferredBranchId,
      })
      .returning()
    return row!
  }

  async updatePatient(patientId: string, patch: Partial<typeof patients.$inferInsert>) {
    const [row] = await this.db
      .update(patients)
      .set(patch)
      .where(and(eq(patients.orgId, this.orgId), eq(patients.id, patientId)))
      .returning()
    return row
  }

  /**
   * What the agent should already know about this caller.
   *
   * Facts, never inferences. "You usually see Dr Iyer at Bandra" is a record;
   * anything about their mouth is a clinical judgement the agent must not make.
   */
  async patientMemory(patientId: string) {
    const [p] = await this.db
      .select()
      .from(patients)
      .where(and(eq(patients.orgId, this.orgId), eq(patients.id, patientId)))
      .limit(1)
    if (!p) return null

    const history = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.orgId, this.orgId), eq(appointments.patientId, patientId)))
      .orderBy(desc(appointments.startAt))
      .limit(10)

    const recentCalls = await this.db
      .select({
        id: calls.id,
        startedAt: calls.startedAt,
        outcome: calls.outcome,
        summary: calls.summary,
        language: calls.language,
      })
      .from(calls)
      .where(and(eq(calls.orgId, this.orgId), eq(calls.patientId, patientId)))
      .orderBy(desc(calls.startedAt))
      .limit(5)

    const open = await this.db
      .select()
      .from(escalations)
      .where(
        and(
          eq(escalations.orgId, this.orgId),
          eq(escalations.patientId, patientId),
          ne(escalations.status, 'resolved'),
        ),
      )

    return { patient: p, history, recentCalls, outstanding: open }
  }

  // ── The diary ──────────────────────────────────────────────────────────────

  /**
   * Everything already committed in a window.
   *
   * One query feeding both the solver and the booking guard, because two
   * different reads of "what is busy" is how a double-booking gets in.
   */
  private async busyBetween(fromMs: number, toMs: number): Promise<BusyBlock[]> {
    const rows = await this.db
      .select({
        providerId: appointments.providerId,
        operatoryId: appointments.operatoryId,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.orgId, this.orgId),
          inArray(appointments.status, ['booked', 'confirmed']),
          lt(appointments.startAt, new Date(toMs)),
          gte(appointments.endAt, new Date(fromMs)),
        ),
      )
    return rows.map((r) => ({
      providerId: r.providerId,
      operatoryId: r.operatoryId,
      startMs: r.startAt.getTime(),
      endMs: r.endAt.getTime(),
    }))
  }

  async findSlots(opts: {
    serviceId: string
    branchId?: string
    providerId?: string
    fromDays?: number
    horizonDays?: number
    preferMorning?: boolean
    preferEvening?: boolean
    limit?: number
    now?: Date
  }): Promise<Slot[]> {
    const [org, svcList, provList, opList, branchList] = await Promise.all([
      this.org(),
      this.services(),
      this.providers(),
      this.operatories(),
      this.branches(),
    ])
    const service = svcList.find((s) => s.id === opts.serviceId)
    if (!service || !org) return []

    const now = opts.now ?? new Date()
    const horizon = opts.horizonDays ?? 14
    const busy = await this.busyBetween(
      now.getTime(),
      now.getTime() + (horizon + 2) * 24 * 3600_000,
    )

    return solveSlots({
      service: {
        id: service.id,
        name: service.name,
        durationMin: service.durationMin,
        // Turnaround scales with the procedure: a filling needs a wipe-down, a
        // surgical extraction needs the room reset.
        bufferMin: service.durationMin >= 60 ? 15 : 10,
        requiresSpecialty: service.requiresSpecialty,
        requiresEquipment: service.requiresEquipment,
      },
      providers: provList.map((p) => ({
        id: p.id,
        name: p.name,
        specialties: p.specialties,
        days: p.days,
        branchIds: p.branchIds,
      })),
      operatories: opList.map((o) => ({ id: o.id, branchId: o.branchId, equipment: o.equipment })),
      branches: branchList.map((b) => ({ id: b.id, hours: b.hours as BranchHours[] })),
      busy,
      now,
      timezone: org.timezone,
      branchId: opts.branchId,
      providerId: opts.providerId,
      fromDays: opts.fromDays,
      horizonDays: horizon,
      preferMorning: opts.preferMorning,
      preferEvening: opts.preferEvening,
      limit: opts.limit,
    })
  }

  /**
   * Commit a slot.
   *
   * Re-checks availability inside a transaction rather than trusting the search
   * that produced the offer. Between "six fifteen with Dr Iyer?" and "yes", the
   * front desk can take that chair — and two patients arriving for one room is
   * the single worst thing this system can do to a practice.
   */
  async book(input: {
    patientId: string
    serviceId: string
    providerId: string
    operatoryId: string
    branchId: string
    startIso: string
    durationMin: number
    callId?: string
    source?: string
    notes?: string
  }): Promise<{ ok: true; appointment: typeof appointments.$inferSelect } | { ok: false; reason: string }> {
    const startMs = new Date(input.startIso).getTime()
    if (!Number.isFinite(startMs)) return { ok: false, reason: 'invalid_start' }
    const endMs = startMs + input.durationMin * 60_000

    return this.db.transaction(async (tx) => {
      const clashes = await tx
        .select({
          providerId: appointments.providerId,
          operatoryId: appointments.operatoryId,
          startAt: appointments.startAt,
          endAt: appointments.endAt,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.orgId, this.orgId),
            inArray(appointments.status, ['booked', 'confirmed']),
            lt(appointments.startAt, new Date(endMs)),
            gte(appointments.endAt, new Date(startMs)),
            or(
              eq(appointments.providerId, input.providerId),
              eq(appointments.operatoryId, input.operatoryId),
            ),
          ),
        )

      const busy: BusyBlock[] = clashes.map((c) => ({
        providerId: c.providerId,
        operatoryId: c.operatoryId,
        startMs: c.startAt.getTime(),
        endMs: c.endAt.getTime(),
      }))
      if (!slotStillFree(busy, startMs, endMs, input.providerId, input.operatoryId)) {
        return { ok: false as const, reason: 'slot_taken' }
      }

      const [row] = await tx
        .insert(appointments)
        .values({
          id: id('apt'),
          orgId: this.orgId,
          branchId: input.branchId,
          patientId: input.patientId,
          providerId: input.providerId,
          operatoryId: input.operatoryId,
          serviceId: input.serviceId,
          startAt: new Date(startMs),
          endAt: new Date(endMs),
          callId: input.callId,
          source: input.source ?? 'phone',
          notes: input.notes,
        })
        .returning()
      return { ok: true as const, appointment: row! }
    })
  }

  async appointmentsFor(patientId: string, opts: { upcomingOnly?: boolean } = {}) {
    const conds = [eq(appointments.orgId, this.orgId), eq(appointments.patientId, patientId)]
    if (opts.upcomingOnly) {
      conds.push(gte(appointments.startAt, new Date()))
      conds.push(inArray(appointments.status, ['booked', 'confirmed']))
    }
    return this.db.select().from(appointments).where(and(...conds)).orderBy(asc(appointments.startAt))
  }

  async cancelAppointment(appointmentId: string, reason?: string) {
    const [row] = await this.db
      .update(appointments)
      .set({ status: 'cancelled', notes: reason })
      .where(and(eq(appointments.orgId, this.orgId), eq(appointments.id, appointmentId)))
      .returning()
    return row
  }

  async rescheduleAppointment(
    appointmentId: string,
    to: { startIso: string; providerId: string; operatoryId: string; durationMin: number },
  ) {
    const [current] = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.orgId, this.orgId), eq(appointments.id, appointmentId)))
      .limit(1)
    if (!current) return { ok: false as const, reason: 'not_found' }

    const booked = await this.book({
      patientId: current.patientId,
      serviceId: current.serviceId,
      providerId: to.providerId,
      operatoryId: to.operatoryId,
      branchId: current.branchId,
      startIso: to.startIso,
      durationMin: to.durationMin,
      source: 'reschedule',
    })
    if (!booked.ok) return booked

    // Only after the new one exists. Cancelling first and failing to rebook
    // leaves the patient with nothing and no record of why.
    await this.cancelAppointment(appointmentId, 'rescheduled')
    return booked
  }

  // ── Waitlist ───────────────────────────────────────────────────────────────

  async addToWaitlist(input: {
    patientId: string
    serviceId?: string
    branchId?: string
    providerId?: string
    preference?: string
    priority?: number
  }) {
    const [row] = await this.db
      .insert(waitlist)
      .values({ id: id('wl'), orgId: this.orgId, ...input })
      .returning()
    return row!
  }

  /** Who to call when a slot frees up, most urgent first. */
  async waitlistFor(opts: { serviceId?: string; branchId?: string; limit?: number }) {
    const conds = [eq(waitlist.orgId, this.orgId), eq(waitlist.status, 'waiting')]
    if (opts.serviceId) conds.push(eq(waitlist.serviceId, opts.serviceId))
    if (opts.branchId) conds.push(eq(waitlist.branchId, opts.branchId))
    return this.db
      .select()
      .from(waitlist)
      .where(and(...conds))
      .orderBy(desc(waitlist.priority), asc(waitlist.createdAt))
      .limit(opts.limit ?? 20)
  }

  // ── Calls ──────────────────────────────────────────────────────────────────

  async startCall(input: {
    id?: string
    channel: 'web' | 'twilio' | 'whatsapp'
    direction?: 'inbound' | 'outbound'
    externalId?: string
    fromNumber?: string
    toNumber?: string
    branchId?: string
    patientId?: string
    /** Back-dated imports and campaign dials both need to set this. */
    startedAt?: Date
  }) {
    const [row] = await this.db
      .insert(calls)
      .values({
        id: input.id ?? id('call'),
        startedAt: input.startedAt,
        orgId: this.orgId,
        channel: input.channel,
        direction: input.direction ?? 'inbound',
        externalId: input.externalId,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        branchId: input.branchId,
        patientId: input.patientId,
      })
      .returning()
    return row!
  }

  async finishCall(
    callId: string,
    patch: Partial<typeof calls.$inferInsert> & { transcript?: CallTurn[] },
  ) {
    const [row] = await this.db
      .update(calls)
      .set({ ...patch, endedAt: patch.endedAt ?? new Date() })
      .where(and(eq(calls.orgId, this.orgId), eq(calls.id, callId)))
      .returning()
    return row
  }

  /** One row per thing that happened, with the millisecond it happened at. */
  async trace(
    callId: string,
    kind: string,
    atMs: number,
    detail?: Record<string, unknown>,
    extra?: { durationMs?: number; ok?: boolean },
  ) {
    await this.db.insert(callEvents).values({
      id: id('ev'),
      orgId: this.orgId,
      callId,
      atMs,
      kind,
      detail,
      durationMs: extra?.durationMs,
      ok: extra?.ok,
    })
  }

  async callTrace(callId: string) {
    return this.db
      .select()
      .from(callEvents)
      .where(and(eq(callEvents.orgId, this.orgId), eq(callEvents.callId, callId)))
      .orderBy(asc(callEvents.atMs))
  }

  async recentCalls(opts: { limit?: number; outcome?: string } = {}) {
    const conds = [eq(calls.orgId, this.orgId)]
    if (opts.outcome) conds.push(eq(calls.outcome, opts.outcome as never))
    return this.db
      .select()
      .from(calls)
      .where(and(...conds))
      .orderBy(desc(calls.startedAt))
      .limit(opts.limit ?? 50)
  }

  async call(callId: string) {
    const [row] = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.orgId, this.orgId), eq(calls.id, callId)))
      .limit(1)
    return row
  }

  // ── Escalations ────────────────────────────────────────────────────────────

  async escalate(input: {
    callId: string
    patientId?: string
    reason: string
    urgency: 'low' | 'normal' | 'high' | 'emergency'
    brief: HandoffBrief
  }) {
    const [row] = await this.db
      .insert(escalations)
      .values({ id: id('esc'), orgId: this.orgId, ...input })
      .returning()
    return row!
  }

  async openEscalations() {
    return this.db
      .select()
      .from(escalations)
      .where(and(eq(escalations.orgId, this.orgId), ne(escalations.status, 'resolved')))
      .orderBy(desc(escalations.createdAt))
  }

  async resolveEscalation(escalationId: string, userId?: string) {
    const [row] = await this.db
      .update(escalations)
      .set({ status: 'resolved', resolvedAt: new Date(), assignedTo: userId })
      .where(and(eq(escalations.orgId, this.orgId), eq(escalations.id, escalationId)))
      .returning()
    return row
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  async dueCampaignTargets(limit = 20) {
    return this.db
      .select()
      .from(campaignTargets)
      .where(
        and(
          eq(campaignTargets.orgId, this.orgId),
          eq(campaignTargets.status, 'queued'),
          or(
            sql`${campaignTargets.nextAttemptAt} is null`,
            lte(campaignTargets.nextAttemptAt, new Date()),
          ),
        ),
      )
      .orderBy(asc(campaignTargets.nextAttemptAt))
      .limit(limit)
  }

  async campaign(campaignId: string) {
    const [row] = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.orgId, this.orgId), eq(campaigns.id, campaignId)))
      .limit(1)
    return row
  }

  async markTarget(targetId: string, patch: Partial<typeof campaignTargets.$inferInsert>) {
    const [row] = await this.db
      .update(campaignTargets)
      .set(patch)
      .where(and(eq(campaignTargets.orgId, this.orgId), eq(campaignTargets.id, targetId)))
      .returning()
    return row
  }

  async audit(action: string, target?: string, detail?: Record<string, unknown>, actorId?: string) {
    await this.db
      .insert(auditLog)
      .values({ id: id('aud'), orgId: this.orgId, action, target, detail, actorId })
  }
}

/**
 * Turn a dialled number into a tenant.
 *
 * The only query in this package without an org, because an inbound call knows
 * nothing else. Everything downstream is scoped by what this returns, so a
 * wrong answer here is one clinic answering with another clinic's diary — which
 * is why the number column is globally unique and the lookup is exact-match on
 * E.164 rather than anything fuzzy.
 */
export async function resolveTenant(
  db: Database,
  dialled: string,
): Promise<{ orgId: string; branchId: string | null } | null> {
  const [row] = await db
    .select({ orgId: phoneNumbers.orgId, branchId: phoneNumbers.branchId })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.e164, dialled.trim()), eq(phoneNumbers.active, true)))
    .limit(1)
  return row ?? null
}

/**
 * Indian mobile numbers, in one shape.
 *
 * A patient says "98765 43210", the front desk types "+91 98765-43210", and
 * Twilio sends "+919876543210". Storing them as typed means the same person
 * becomes three records and none of them get their reminder.
 */
export function normalisePhone(input: string): string {
  const digits = (input ?? '').replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  return digits ? `+${digits}` : ''
}

let seq = 0
export function id(prefix: string): string {
  seq = (seq + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(4, '0')}`
}
