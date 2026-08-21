import type { Lang } from '@vaani/shared'
import type { OrgRepo } from './repo'

/**
 * One clinic's data, shaped the way the tools already expect it.
 *
 * The tools were written against an in-memory `PracticeStore` and are good
 * code; rewriting thirteen of them to speak SQL would risk behaviour that a
 * year of tuning got right. So this presents the same surface over Postgres.
 *
 * The split is deliberate and it is the whole design:
 *
 *   **Static data is loaded once per call and served synchronously.** A
 *   practice's dentists, treatments and rooms do not change during a two-minute
 *   phone call, and re-querying them per tool call would add a database
 *   round-trip to the middle of a sentence.
 *
 *   **The diary is always read live.** Availability is the one thing that
 *   changes while the caller is still talking — another caller, or the front
 *   desk, can take the chair between the offer and the acceptance. Caching it
 *   is how two patients arrive for the same slot.
 */

export interface AdapterTask {
  id: string
  kind: 'callback' | 'escalation' | 'note'
  detail: string
  urgency: 'low' | 'normal' | 'high'
}

export interface AdapterAppointment {
  id: string
  serviceId: string
  providerId: string
  operatoryId: string
  start: string
  durationMin: number
  status: string
}

export class OrgPracticeAdapter {
  readonly name: string
  readonly timezone: string
  readonly languages: Lang[]
  readonly voice: string

  /** Preloaded per call — see the note above on why these are synchronous. */
  readonly providers: Array<{
    id: string
    name: string
    title: string
    specialties: string[]
    languages: string[]
    pronunciation: string | null
    branchIds: string[]
  }>
  readonly services: Array<{
    id: string
    name: string
    alsoCalled: string[]
    durationMin: number
    priceMinPaise: number | null
    priceMaxPaise: number | null
    requiresSpecialty: string[]
  }>
  readonly operatories: Array<{ id: string; branchId: string; name: string; equipment: string[] }>
  readonly branches: Array<{
    id: string
    name: string
    area: string
    city: string
    phone: string | null
    emergencyPhone: string | null
  }>

  /** Populated as the call identifies people; never a whole-tenant dump. */
  patients: Array<{ id: string; name: string; phone: string; preferredLanguage: string | null }> = []
  waitlist: Array<{ id: string; patientId: string; serviceId: string | null }> = []
  readonly tasks: AdapterTask[] = []

  private constructor(
    private readonly repo: OrgRepo,
    private readonly callId: string | undefined,
    loaded: Loaded,
  ) {
    this.name = loaded.orgName
    this.timezone = loaded.timezone
    this.languages = loaded.languages
    this.voice = loaded.voice
    this.providers = loaded.providers
    this.services = loaded.services
    this.operatories = loaded.operatories
    this.branches = loaded.branches
  }

  static async load(repo: OrgRepo, callId?: string): Promise<OrgPracticeAdapter> {
    const [org, providers, services, operatories, branches] = await Promise.all([
      repo.org(),
      repo.providers(),
      repo.services(),
      repo.operatories(),
      repo.branches(),
    ])
    if (!org) throw new Error(`organisation ${repo.orgId} not found`)

    return new OrgPracticeAdapter(repo, callId, {
      orgName: org.name,
      timezone: org.timezone,
      languages: (org.languages as Lang[]) ?? ['en-IN'],
      voice: org.voice,
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        title: p.title,
        specialties: p.specialties,
        languages: p.languages,
        pronunciation: p.pronunciation,
        branchIds: p.branchIds,
      })),
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        alsoCalled: s.alsoCalled,
        durationMin: s.durationMin,
        priceMinPaise: s.priceMinPaise,
        priceMaxPaise: s.priceMaxPaise,
        requiresSpecialty: s.requiresSpecialty,
      })),
      operatories: operatories.map((o) => ({
        id: o.id,
        branchId: o.branchId,
        name: o.name,
        equipment: o.equipment,
      })),
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        area: b.area,
        city: b.city,
        phone: b.phone,
        emergencyPhone: b.emergencyPhone,
      })),
    })
  }

  // ── Synchronous lookups over preloaded data ────────────────────────────────

  provider(id: string) {
    return this.providers.find((p) => p.id === id)
  }

  findService(query: string) {
    const q = (query ?? '').toLowerCase().trim()
    if (!q) return undefined
    const exact = this.services.find((s) => s.name.toLowerCase() === q)
    if (exact) return exact
    const byAlias = this.services
      .flatMap((s) => s.alsoCalled.map((a) => ({ s, a: a.toLowerCase() })))
      .sort((x, y) => y.a.length - x.a.length)
      .find(({ a }) => q === a || q.includes(a))
    if (byAlias) return byAlias.s
    return this.services.find((s) => q.includes(s.name.toLowerCase()))
  }

  // ── Live reads and writes ──────────────────────────────────────────────────

  async findPatientByPhone(phone: string) {
    const row = await this.repo.findPatientByPhone(phone)
    return row ? this.remember(row) : undefined
  }

  async findPatientByName(name: string) {
    const row = await this.repo.findPatientByName(name)
    return row ? this.remember(row) : undefined
  }

  async createPatient(input: { name: string; phone: string; preferredLanguage?: Lang }) {
    const row = await this.repo.createPatient(input)
    return this.remember(row)
  }

  async upcomingFor(patientId: string): Promise<AdapterAppointment[]> {
    const rows = await this.repo.appointmentsFor(patientId, { upcomingOnly: true })
    return rows.map((a) => ({
      id: a.id,
      serviceId: a.serviceId,
      providerId: a.providerId,
      operatoryId: a.operatoryId,
      start: a.startAt.toISOString(),
      durationMin: Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60_000),
      status: a.status,
    }))
  }

  async findSlots(opts: {
    serviceId: string
    providerId?: string
    branchId?: string
    fromDays?: number
    days?: number
    preferMorning?: boolean
    preferEvening?: boolean
    limit?: number
  }) {
    const slots = await this.repo.findSlots({
      serviceId: opts.serviceId,
      providerId: opts.providerId,
      branchId: opts.branchId,
      fromDays: opts.fromDays,
      horizonDays: opts.days,
      preferMorning: opts.preferMorning,
      preferEvening: opts.preferEvening,
      limit: opts.limit,
    })
    return slots.map((s) => ({
      start: s.start,
      providerId: s.providerId,
      providerName: s.providerName,
      operatoryId: s.operatoryId,
      branchId: s.branchId,
      durationMin: s.durationMin,
    }))
  }

  /**
   * Book, re-checking availability inside the write.
   *
   * Named `bookAtomic` because the naive version — search, then insert — is a
   * lost update that shows up as two patients in one chair.
   */
  async bookAtomic(input: {
    patientId: string
    serviceId: string
    providerId: string
    operatoryId: string
    start: string
    durationMin: number
    branchId?: string
  }) {
    const branchId =
      input.branchId ?? this.operatories.find((o) => o.id === input.operatoryId)?.branchId
    if (!branchId) return { ok: false as const, reason: 'unknown_branch' }

    const result = await this.repo.book({
      patientId: input.patientId,
      serviceId: input.serviceId,
      providerId: input.providerId,
      operatoryId: input.operatoryId,
      branchId,
      startIso: input.start,
      durationMin: input.durationMin,
      callId: this.callId,
    })
    if (!result.ok) return result
    return {
      ok: true as const,
      appointment: {
        id: result.appointment.id,
        serviceId: result.appointment.serviceId,
        providerId: result.appointment.providerId,
        operatoryId: result.appointment.operatoryId,
        start: result.appointment.startAt.toISOString(),
        durationMin: input.durationMin,
        status: result.appointment.status,
      },
    }
  }

  async reschedule(input: {
    appointmentId: string
    start: string
    providerId: string
    operatoryId: string
    durationMin: number
  }) {
    const out = await this.repo.rescheduleAppointment(input.appointmentId, {
      startIso: input.start,
      providerId: input.providerId,
      operatoryId: input.operatoryId,
      durationMin: input.durationMin,
    })
    if (!out.ok) return out
    return {
      ok: true as const,
      appointment: {
        id: out.appointment.id,
        serviceId: out.appointment.serviceId,
        providerId: out.appointment.providerId,
        operatoryId: out.appointment.operatoryId,
        start: out.appointment.startAt.toISOString(),
        durationMin: input.durationMin,
        status: out.appointment.status,
      },
    }
  }

  async cancel(appointmentId: string) {
    const row = await this.repo.cancelAppointment(appointmentId)
    if (!row) return undefined
    return {
      id: row.id,
      serviceId: row.serviceId,
      providerId: row.providerId,
      operatoryId: row.operatoryId,
      start: row.startAt.toISOString(),
      durationMin: Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000),
      status: row.status,
    }
  }

  async joinWaitlist(patientId: string, serviceId: string, preference: string) {
    const row = await this.repo.addToWaitlist({ patientId, serviceId, preference })
    const entry = { id: row.id, patientId: row.patientId, serviceId: row.serviceId }
    this.waitlist.push(entry)
    return entry
  }

  /**
   * Something a human has to do.
   *
   * Written straight through to the database rather than held in memory: a task
   * that only exists in a process is a task lost when the call ends badly, and
   * the calls that end badly are exactly the ones that generate tasks.
   */
  async addTask(
    kind: 'callback' | 'escalation' | 'note',
    detail: string,
    urgency: 'low' | 'normal' | 'high',
  ): Promise<AdapterTask> {
    const task: AdapterTask = { id: `task_${this.tasks.length + 1}`, kind, detail, urgency }
    this.tasks.push(task)

    if (this.callId && kind !== 'note') {
      const created = await this.repo.escalate({
        callId: this.callId,
        patientId: this.patients[0]?.id,
        reason: detail,
        urgency: urgency === 'high' ? 'high' : urgency === 'normal' ? 'normal' : 'low',
        brief: {
          patientName: this.patients[0]?.name,
          patientPhone: this.patients[0]?.phone,
          reason: detail,
          whatHappened: [],
          agentActions: [],
          recommendedAction:
            kind === 'escalation' ? 'Call the patient back.' : 'Review when convenient.',
        },
      })
      task.id = created.id
    }
    return task
  }

  private remember(row: {
    id: string
    name: string
    phone: string
    preferredLanguage: string | null
  }) {
    const known = { id: row.id, name: row.name, phone: row.phone, preferredLanguage: row.preferredLanguage }
    if (!this.patients.some((p) => p.id === known.id)) this.patients.push(known)
    return known
  }
}

interface Loaded {
  orgName: string
  timezone: string
  languages: Lang[]
  voice: string
  providers: OrgPracticeAdapter['providers']
  services: OrgPracticeAdapter['services']
  operatories: OrgPracticeAdapter['operatories']
  branches: OrgPracticeAdapter['branches']
}
