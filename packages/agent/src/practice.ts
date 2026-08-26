import type { Lang } from '@vaani/shared'
import { BRANCHES, DOCTORS } from './clinic-data'

/**
 * The practice: providers, chairs, services, patients, and the slot solver.
 *
 * Held in memory with a deterministic seed. The interface is deliberately the
 * one a Drizzle-backed store would expose, so swapping in Postgres is a change
 * of implementation rather than of shape.
 */

export interface Provider {
  id: string
  name: string
  title: string
  specialties: string[]
  /** Weekday indices worked, 0 = Sunday. */
  days: number[]
  startHour: number
  endHour: number
  languages: Lang[]
}

export interface Operatory {
  id: string
  name: string
}

export interface Service {
  id: string
  name: string
  nameHi: string
  durationMin: number
  bufferMin: number
  priceMin: number
  priceMax: number
  /** Provider ids qualified to perform it; empty means any. */
  providers: string[]
}

export interface Patient {
  id: string
  name: string
  phone: string
  dob?: string
  preferredLanguage: Lang
  notes?: string
  lastVisit?: string
}

export interface Appointment {
  id: string
  patientId: string
  providerId: string
  operatoryId: string
  serviceId: string
  /** ISO timestamp. */
  start: string
  durationMin: number
  status: 'booked' | 'cancelled' | 'completed'
  notes?: string
}

export interface Slot {
  start: string
  providerId: string
  providerName: string
  operatoryId: string
  durationMin: number
}

export interface WaitlistEntry {
  id: string
  patientId: string
  serviceId: string
  preference: string
  createdAt: string
}

export interface Task {
  id: string
  kind: 'callback' | 'escalation' | 'note'
  detail: string
  urgency: 'low' | 'normal' | 'high'
  createdAt: string
}

// ─── Seed ────────────────────────────────────────────────────────────────────

/**
 * The bookable clinical team, derived from the clinic data.
 *
 * These were two hand-maintained lists and they drifted: the knowledge base
 * described six doctors while the scheduler knew three. A caller asking for
 * Dr. Qureshi got his full credentials and then could never be given an
 * appointment with him — the agent grounded on one list and booked from the
 * other.
 *
 * One list now. Anything describable is bookable.
 */
export const PROVIDERS: Provider[] = DOCTORS.map((d) => ({
  id: d.id,
  name: d.name,
  title: d.title,
  specialties: d.specialties,
  days: d.days,
  startHour: d.startHour,
  endHour: d.endHour,
  languages: d.languages.map((l) =>
    l === 'Hindi' ? 'hi-IN' : l === 'English' ? 'en-IN' : 'hi-Latn-IN',
  ) as Lang[],
}))

export const OPERATORIES: Operatory[] = [
  { id: 'o1', name: 'Chair 1' },
  { id: 'o2', name: 'Chair 2' },
  { id: 'o3', name: 'Chair 3' },
  { id: 'o4', name: 'Surgery Suite' },
]

export const SERVICES: Service[] = [
  { id: 's1', name: 'Consultation', nameHi: 'परामर्श', durationMin: 20, bufferMin: 5, priceMin: 500, priceMax: 800, providers: [] },
  { id: 's2', name: 'Scaling & Polishing', nameHi: 'स्केलिंग और पॉलिशिंग', durationMin: 30, bufferMin: 10, priceMin: 1500, priceMax: 2500, providers: ['p1', 'p3'] },
  { id: 's3', name: 'Composite Filling', nameHi: 'फिलिंग', durationMin: 45, bufferMin: 10, priceMin: 1200, priceMax: 3000, providers: ['p1', 'p3'] },
  { id: 's4', name: 'Root Canal', nameHi: 'रूट कैनाल', durationMin: 90, bufferMin: 15, priceMin: 6000, priceMax: 12000, providers: ['p1'] },
  { id: 's5', name: 'Crown Fitting', nameHi: 'क्राउन', durationMin: 60, bufferMin: 10, priceMin: 8000, priceMax: 20000, providers: ['p1'] },
  { id: 's6', name: 'Tooth Extraction', nameHi: 'दांत निकालना', durationMin: 45, bufferMin: 15, priceMin: 2000, priceMax: 5000, providers: ['p1', 'p3'] },
  { id: 's7', name: 'Wisdom Tooth Surgery', nameHi: 'अक्ल दाढ़ सर्जरी', durationMin: 90, bufferMin: 20, priceMin: 12000, priceMax: 25000, providers: ['p3', 'p6'] },
  { id: 's8', name: 'Teeth Whitening', nameHi: 'दांत सफ़ेद करना', durationMin: 60, bufferMin: 10, priceMin: 8000, priceMax: 15000, providers: ['p1', 'p5'] },
  { id: 's9', name: 'Braces Consultation', nameHi: 'ब्रेसेज़ परामर्श', durationMin: 30, bufferMin: 5, priceMin: 800, priceMax: 1000, providers: ['p2'] },
  { id: 's10', name: 'Braces Adjustment', nameHi: 'ब्रेसेज़ एडजस्टमेंट', durationMin: 30, bufferMin: 5, priceMin: 1500, priceMax: 2500, providers: ['p2'] },
  { id: 's11', name: 'Denture Fitting', nameHi: 'डेन्चर', durationMin: 60, bufferMin: 10, priceMin: 15000, priceMax: 40000, providers: ['p3', 'p5'] },
  { id: 's12', name: 'Emergency Visit', nameHi: 'इमरजेंसी', durationMin: 30, bufferMin: 15, priceMin: 1000, priceMax: 2000, providers: [] },
]

/**
 * What callers actually say, mapped to what the catalogue calls it.
 *
 * Ordered most-specific-first within each entry, and checked before the
 * generic substring match so "wisdom tooth" does not resolve to plain
 * "Tooth Extraction".
 */
const SERVICE_SYNONYMS: Record<string, string[]> = {
  s7: ['wisdom tooth', 'wisdom teeth', 'akal daadh', 'akkal daadh', 'third molar'],
  s2: ['cleaning', 'clean', 'scaling', 'polish', 'polishing', 'safai', 'saaf', 'tartar', 'plaque', 'wash'],
  s4: ['root canal', 'rct', 'nerve treatment', 'nas ka ilaaj'],
  s5: ['crown', 'cap', 'capping', 'topi'],
  s3: ['filling', 'cavity', 'fill', 'bharna', 'composite'],
  s6: ['extraction', 'pull out', 'remove tooth', 'take out', 'nikalna', 'nikalwana', 'ukhadna'],
  s8: ['whiten', 'whitening', 'bleaching', 'white teeth', 'safed', 'brightening'],
  s9: ['braces consultation', 'braces', 'aligners', 'invisalign', 'teeth straightening', 'tedhe daant'],
  s10: ['braces adjustment', 'wire change', 'tightening', 'adjustment'],
  s11: ['denture', 'dentures', 'false teeth', 'nakli daant', 'implant'],
  s12: ['emergency', 'urgent', 'turant', 'emergency visit'],
  s1: ['consultation', 'checkup', 'check up', 'check-up', 'opinion', 'second opinion', 'jaanch', 'dikhana'],
}

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kabir', 'Meera', 'Nisha', 'Rahul', 'Priya', 'Sanjay', 'Tanvi', 'Ujjwal', 'Vikram', 'Zoya', 'Farhan', 'Gaurav', 'Harsh', 'Ira']
const LAST = ['Sharma', 'Verma', 'Gupta', 'Reddy', 'Nair', 'Patel', 'Singh', 'Kapoor', 'Joshi', 'Rao']

/** Deterministic PRNG — the same demo every time, which matters on stage. */
function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LANGS: Lang[] = ['en-IN', 'hi-IN', 'hi-Latn-IN']

export function seedPatients(count = 44): Patient[] {
  const rnd = mulberry(20260817)
  const out: Patient[] = []
  for (let i = 0; i < count; i++) {
    const first = FIRST[Math.floor(rnd() * FIRST.length)]!
    const last = LAST[Math.floor(rnd() * LAST.length)]!
    out.push({
      id: `pt${i + 1}`,
      name: `${first} ${last}`,
      phone: `9${Math.floor(rnd() * 900000000 + 100000000)}`,
      preferredLanguage: LANGS[Math.floor(rnd() * 3)]!,
      lastVisit: rnd() > 0.4 ? isoDaysFromNow(-Math.floor(rnd() * 300) - 10) : undefined,
    })
  }
  return out
}

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class PracticeStore {
  readonly name = process.env.PRACTICE_NAME ?? 'Smile Dental Care, Bandra'
  readonly providers = PROVIDERS
  /**
   * Exposed so the prompt can carry hours and numbers.
   *
   * These are the facts a caller asks for most and that change least, and
   * every one that is not in the prompt costs a lookup — which on a live call
   * is a round trip the caller hears as silence.
   */
  readonly branches = BRANCHES
  readonly operatories = OPERATORIES
  readonly services = SERVICES
  patients: Patient[] = seedPatients()
  appointments: Appointment[] = []
  waitlist: WaitlistEntry[] = []
  tasks: Task[] = []

  private seq = 0

  constructor() {
    this.seedAppointments()
  }

  private id(prefix: string): string {
    return `${prefix}${++this.seq}_${Math.floor(Date.now() % 100000)}`
  }

  /**
   * Fill the next two weeks to roughly 55 % occupancy.
   *
   * Dense enough that the calendar looks like a real practice, sparse enough
   * that a live booking always succeeds. An empty calendar makes a demo look
   * fake; a full one makes it fail.
   */
  private seedAppointments(): void {
    const rnd = mulberry(424242)
    for (let day = 0; day < 14; day++) {
      const date = new Date()
      date.setDate(date.getDate() + day)
      if (date.getDay() === 0) continue

      for (const provider of this.providers) {
        if (!provider.days.includes(date.getDay())) continue
        for (let hour = provider.startHour; hour < provider.endHour; hour++) {
          if (rnd() > 0.55) continue
          const service = this.services[Math.floor(rnd() * this.services.length)]!
          const patient = this.patients[Math.floor(rnd() * this.patients.length)]!
          const operatory = this.operatories[Math.floor(rnd() * this.operatories.length)]!
          const start = new Date(date)
          start.setHours(hour, rnd() > 0.5 ? 30 : 0, 0, 0)
          this.appointments.push({
            id: this.id('ap'),
            patientId: patient.id,
            providerId: provider.id,
            operatoryId: operatory.id,
            serviceId: service.id,
            start: start.toISOString(),
            durationMin: service.durationMin,
            status: 'booked',
          })
        }
      }
    }
  }

  // ─── Lookups ───────────────────────────────────────────────────────────────

  findPatientByPhone(phone: string): Patient | undefined {
    const digits = phone.replace(/\D/g, '').slice(-10)
    return this.patients.find((p) => p.phone.replace(/\D/g, '').slice(-10) === digits)
  }

  findPatientByName(name: string): Patient | undefined {
    const n = name.trim().toLowerCase()
    return this.patients.find((p) => p.name.toLowerCase().includes(n))
  }

  createPatient(input: { name: string; phone: string; preferredLanguage?: Lang }): Patient {
    const patient: Patient = {
      id: this.id('pt'),
      name: input.name,
      phone: input.phone,
      preferredLanguage: input.preferredLanguage ?? 'en-IN',
    }
    this.patients.push(patient)
    return patient
  }

  /**
   * Resolve what the caller said into a service on the price list.
   *
   * Nobody rings a dentist and asks for "Scaling & Polishing" — they ask for a
   * cleaning, or a safai, or "just the normal wash". Matching only on the
   * catalogue name means the most common request in the book fails to resolve,
   * so the vocabulary callers actually use is a first-class part of the lookup.
   */
  findService(query: string): Service | undefined {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return undefined

    const exact = this.services.find((s) => s.name.toLowerCase() === q)
    if (exact) return exact

    for (const [serviceId, words] of Object.entries(SERVICE_SYNONYMS)) {
      if (words.some((w) => q === w || q.includes(w))) {
        const match = this.services.find((s) => s.id === serviceId)
        if (match) return match
      }
    }

    return (
      this.services.find(
        (s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()),
      ) ?? this.services.find((s) => s.nameHi.includes(query.trim()))
    )
  }

  provider(id: string): Provider | undefined {
    return this.providers.find((p) => p.id === id)
  }

  // ─── Slot solver ───────────────────────────────────────────────────────────

  /**
   * Find open slots where the provider *and* a chair are both free for the
   * procedure's full duration plus its turnaround buffer.
   *
   * The buffer is the part naive schedulers miss: back-to-back root canals with
   * no sterilisation gap is a schedule that cannot actually be run.
   */
  findSlots(opts: {
    serviceId: string
    providerId?: string
    fromDays?: number
    days?: number
    preferMorning?: boolean
    preferEvening?: boolean
    limit?: number
  }): Slot[] {
    const service = this.services.find((s) => s.id === opts.serviceId)
    if (!service) return []

    const eligible = this.providers.filter((p) => {
      if (opts.providerId && p.id !== opts.providerId) return false
      if (service.providers.length > 0 && !service.providers.includes(p.id)) return false
      return true
    })

    const need = service.durationMin + service.bufferMin
    const slots: Slot[] = []
    const limit = opts.limit ?? 6
    const horizon = opts.days ?? 10
    const from = opts.fromDays ?? 0

    for (let day = from; day < from + horizon && slots.length < limit; day++) {
      const date = new Date()
      date.setDate(date.getDate() + day)
      if (date.getDay() === 0) continue

      for (const provider of eligible) {
        if (!provider.days.includes(date.getDay())) continue

        for (let min = provider.startHour * 60; min + need <= provider.endHour * 60; min += 30) {
          const hour = Math.floor(min / 60)
          if (opts.preferMorning && hour >= 13) continue
          if (opts.preferEvening && hour < 15) continue

          const start = new Date(date)
          start.setHours(hour, min % 60, 0, 0)
          if (start.getTime() < Date.now() + 60 * 60 * 1000) continue

          const operatory = this.freeOperatory(start, need, provider.id)
          if (!operatory) continue

          slots.push({
            start: start.toISOString(),
            providerId: provider.id,
            providerName: provider.name,
            operatoryId: operatory,
            durationMin: service.durationMin,
          })
          if (slots.length >= limit) break
        }
        if (slots.length >= limit) break
      }
    }

    return slots.sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit)
  }

  /** A chair free for the whole window, with the provider also free. */
  private freeOperatory(start: Date, durationMin: number, providerId: string): string | null {
    const from = start.getTime()
    const to = from + durationMin * 60_000

    const overlaps = (a: Appointment): boolean => {
      const aStart = new Date(a.start).getTime()
      const aEnd = aStart + a.durationMin * 60_000
      return a.status === 'booked' && aStart < to && from < aEnd
    }

    const clashing = this.appointments.filter(overlaps)
    if (clashing.some((a) => a.providerId === providerId)) return null

    const busyChairs = new Set(clashing.map((a) => a.operatoryId))
    return this.operatories.find((o) => !busyChairs.has(o.id))?.id ?? null
  }

  /**
   * Is this exact slot still free?
   *
   * `findSlots` answers "what was open a moment ago". Between offering a time
   * and the caller accepting it, another caller — or the front desk — can take
   * it. Booking on the strength of the earlier search is a lost-update race
   * that surfaces as two patients arriving for the same chair.
   */
  isSlotFree(start: string, durationMin: number, providerId: string, operatoryId: string): boolean {
    const from = new Date(start).getTime()
    const to = from + durationMin * 60_000
    return !this.appointments.some((a) => {
      if (a.status !== 'booked') return false
      if (a.providerId !== providerId && a.operatoryId !== operatoryId) return false
      const s = new Date(a.start).getTime()
      return s < to && from < s + a.durationMin * 60_000
    })
  }

  /**
   * Book, re-checking the slot as part of the same synchronous step.
   *
   * Returns a conflict rather than throwing: "that just went" is an ordinary
   * thing for a receptionist to say, not an exceptional condition.
   */
  bookAtomic(input: {
    patientId: string
    serviceId: string
    start: string
    providerId: string
    operatoryId: string
    notes?: string
  }): { ok: true; appointment: Appointment } | { ok: false; reason: 'taken' | 'unknown_service' } {
    const service = this.services.find((s) => s.id === input.serviceId)
    if (!service) return { ok: false, reason: 'unknown_service' }

    if (!this.isSlotFree(input.start, service.durationMin, input.providerId, input.operatoryId)) {
      return { ok: false, reason: 'taken' }
    }
    return { ok: true, appointment: this.book(input) }
  }

  /**
   * Move an appointment, securing the new slot before releasing the old one.
   *
   * Cancelling first and booking second means a failed second step leaves the
   * patient with no appointment at all — the worst outcome available.
   */
  reschedule(input: {
    appointmentId: string
    start: string
    providerId: string
    operatoryId: string
  }): { ok: true; appointment: Appointment } | { ok: false; reason: 'taken' | 'not_found' } {
    const existing = this.appointments.find(
      (a) => a.id === input.appointmentId && a.status === 'booked',
    )
    if (!existing) return { ok: false, reason: 'not_found' }

    if (!this.isSlotFree(input.start, existing.durationMin, input.providerId, input.operatoryId)) {
      return { ok: false, reason: 'taken' }
    }

    existing.start = input.start
    existing.providerId = input.providerId
    existing.operatoryId = input.operatoryId
    return { ok: true, appointment: existing }
  }

  book(input: {
    patientId: string
    serviceId: string
    start: string
    providerId: string
    operatoryId: string
    notes?: string
  }): Appointment {
    const service = this.services.find((s) => s.id === input.serviceId)!
    const appt: Appointment = {
      id: this.id('ap'),
      patientId: input.patientId,
      providerId: input.providerId,
      operatoryId: input.operatoryId,
      serviceId: input.serviceId,
      start: input.start,
      durationMin: service.durationMin,
      status: 'booked',
      notes: input.notes,
    }
    this.appointments.push(appt)
    return appt
  }

  cancel(appointmentId: string): Appointment | undefined {
    const appt = this.appointments.find((a) => a.id === appointmentId)
    if (appt) appt.status = 'cancelled'
    return appt
  }

  upcomingFor(patientId: string): Appointment[] {
    const now = Date.now()
    return this.appointments
      .filter((a) => a.patientId === patientId && a.status === 'booked')
      .filter((a) => new Date(a.start).getTime() > now)
      .sort((a, b) => a.start.localeCompare(b.start))
  }

  joinWaitlist(patientId: string, serviceId: string, preference: string): WaitlistEntry {
    const entry: WaitlistEntry = {
      id: this.id('wl'),
      patientId,
      serviceId,
      preference,
      createdAt: new Date().toISOString(),
    }
    this.waitlist.push(entry)
    return entry
  }

  addTask(kind: Task['kind'], detail: string, urgency: Task['urgency'] = 'normal'): Task {
    const task: Task = {
      id: this.id('tk'),
      kind,
      detail,
      urgency,
      createdAt: new Date().toISOString(),
    }
    this.tasks.push(task)
    return task
  }
}
