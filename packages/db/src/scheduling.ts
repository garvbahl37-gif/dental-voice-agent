import type { BranchHours } from './schema'

/**
 * The scheduling engine.
 *
 * A calendar lookup answers "what is empty". A dental diary has to answer
 * something harder: *can this particular treatment actually be performed at
 * this time?* Four things must line up at once, and dropping any one of them
 * produces a booking the practice cannot honour.
 *
 *   1. **The dentist is free** — and qualified. A root canal offered to a
 *      dentist who does not do endodontics is a slot the patient loses twice:
 *      once when they arrive, once when they rebook.
 *   2. **A chair is free** — and equipped. Rotary endo and digital X-ray live
 *      in specific rooms.
 *   3. **The full duration fits**, plus turnaround. Back-to-back procedures
 *      with no sterilisation gap is a schedule that cannot be run.
 *   4. **The branch is open**, in the practice's own timezone.
 *
 * Kept as pure functions over plain data so it is testable without a database
 * and identical between the in-memory demo and Postgres.
 */

export interface SchedulingProvider {
  id: string
  name: string
  specialties: string[]
  days: number[]
  branchIds: string[]
}

export interface SchedulingOperatory {
  id: string
  branchId: string
  equipment: string[]
}

export interface SchedulingService {
  id: string
  name: string
  durationMin: number
  bufferMin: number
  requiresSpecialty: string[]
  requiresEquipment: string[]
}

export interface SchedulingBranch {
  id: string
  hours: BranchHours[]
}

export interface BusyBlock {
  providerId: string
  operatoryId: string
  startMs: number
  endMs: number
}

export interface Slot {
  start: string
  endMs: number
  providerId: string
  providerName: string
  operatoryId: string
  branchId: string
  durationMin: number
  /** Why this provider — surfaced so the agent can say "with our endodontist". */
  matchedSpecialty?: string
}

export interface FindSlotsInput {
  service: SchedulingService
  providers: SchedulingProvider[]
  operatories: SchedulingOperatory[]
  branches: SchedulingBranch[]
  busy: BusyBlock[]
  now: Date
  timezone: string
  branchId?: string
  providerId?: string
  fromDays?: number
  horizonDays?: number
  preferMorning?: boolean
  preferEvening?: boolean
  limit?: number
  /** How soon a slot may be offered. Nobody can reach a clinic in ten minutes. */
  leadMinutes?: number
}

const SLOT_STEP_MIN = 15

/**
 * Which providers can actually perform this treatment.
 *
 * Exported because the booking guard has to re-check it: a caller can name a
 * dentist directly, and "book me with Dr Sharma for a root canal" must fail
 * when Dr Sharma is not an endodontist rather than quietly succeed.
 */
export function eligibleProviders(
  service: SchedulingService,
  providers: SchedulingProvider[],
  opts: { branchId?: string; providerId?: string } = {},
): Array<{ provider: SchedulingProvider; matchedSpecialty?: string }> {
  const out: Array<{ provider: SchedulingProvider; matchedSpecialty?: string }> = []
  for (const p of providers) {
    if (opts.providerId && p.id !== opts.providerId) continue
    if (opts.branchId && p.branchIds.length > 0 && !p.branchIds.includes(opts.branchId)) continue

    if (service.requiresSpecialty.length === 0) {
      out.push({ provider: p })
      continue
    }
    const matched = service.requiresSpecialty.find((s) =>
      p.specialties.some((ps) => ps.toLowerCase() === s.toLowerCase()),
    )
    if (matched) out.push({ provider: p, matchedSpecialty: matched })
  }
  // Specialists first: a generalist who *can* do it should not soak up the
  // endodontist's diary while the endodontist sits idle.
  return out.sort((a, b) => (b.matchedSpecialty ? 1 : 0) - (a.matchedSpecialty ? 1 : 0))
}

export function suitableOperatories(
  service: SchedulingService,
  operatories: SchedulingOperatory[],
  branchId?: string,
): SchedulingOperatory[] {
  return operatories.filter((o) => {
    if (branchId && o.branchId !== branchId) return false
    return service.requiresEquipment.every((e) =>
      o.equipment.some((have) => have.toLowerCase() === e.toLowerCase()),
    )
  })
}

/** Minutes past midnight, in the practice's timezone rather than the server's. */
export function localMinutes(at: Date, timezone: string): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(at)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { day: DAYS[weekday] ?? 1, minutes: hour * 60 + minute }
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/** Is the branch open for the whole window? Closing mid-procedure is not open. */
export function branchOpenFor(
  branch: SchedulingBranch,
  start: Date,
  durationMin: number,
  timezone: string,
): boolean {
  const { day, minutes } = localMinutes(start, timezone)
  const today = branch.hours.filter((h) => h.day === day)
  if (today.length === 0) return false
  return today.some((h) => {
    const open = hhmmToMinutes(h.open)
    const close = hhmmToMinutes(h.close)
    return minutes >= open && minutes + durationMin <= close
  })
}

export function findSlots(input: FindSlotsInput): Slot[] {
  const {
    service,
    operatories,
    branches,
    busy,
    now,
    timezone,
    branchId,
    providerId,
    preferMorning,
    preferEvening,
  } = input

  const limit = input.limit ?? 6
  const horizon = input.horizonDays ?? 14
  const fromDays = input.fromDays ?? 0
  const leadMs = (input.leadMinutes ?? 90) * 60_000
  const need = service.durationMin + service.bufferMin

  const eligible = eligibleProviders(service, input.providers, { branchId, providerId })
  if (eligible.length === 0) return []

  const chairs = suitableOperatories(service, operatories, branchId)
  if (chairs.length === 0) return []

  const branchById = new Map(branches.map((b) => [b.id, b]))
  const earliest = now.getTime() + leadMs
  const out: Slot[] = []

  for (let dayOffset = fromDays; dayOffset < fromDays + horizon && out.length < limit; dayOffset++) {
    const cursor = new Date(now)
    cursor.setDate(cursor.getDate() + dayOffset)

    for (const { provider, matchedSpecialty } of eligible) {
      if (out.length >= limit) break

      const providerChairs = chairs.filter(
        (c) => provider.branchIds.length === 0 || provider.branchIds.includes(c.branchId),
      )
      if (providerChairs.length === 0) continue

      // Walk the working day in steps rather than trusting a fixed grid, so a
      // 90-minute procedure can start at 10:15 if that is where the gap is.
      for (let min = 0; min < 24 * 60; min += SLOT_STEP_MIN) {
        if (out.length >= limit) break

        const start = new Date(cursor)
        start.setHours(Math.floor(min / 60), min % 60, 0, 0)
        const startMs = start.getTime()
        if (startMs < earliest) continue

        const local = localMinutes(start, timezone)
        if (!provider.days.includes(local.day)) continue

        const hour = Math.floor(local.minutes / 60)
        if (preferMorning && hour >= 13) continue
        if (preferEvening && hour < 15) continue

        const endMs = startMs + need * 60_000

        const chair = providerChairs.find((c) => {
          const branch = branchById.get(c.branchId)
          if (!branch || !branchOpenFor(branch, start, need, timezone)) return false
          const chairBusy = busy.some(
            (b) => b.operatoryId === c.id && b.startMs < endMs && startMs < b.endMs,
          )
          return !chairBusy
        })
        if (!chair) continue

        const providerBusy = busy.some(
          (b) => b.providerId === provider.id && b.startMs < endMs && startMs < b.endMs,
        )
        if (providerBusy) continue

        out.push({
          start: start.toISOString(),
          endMs,
          providerId: provider.id,
          providerName: provider.name,
          operatoryId: chair.id,
          branchId: chair.branchId,
          durationMin: service.durationMin,
          matchedSpecialty,
        })
        // One offer per provider per day. Reading six consecutive 15-minute
        // slots down the phone is not a choice, it is a recitation.
        break
      }
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit)
}

/**
 * Is this exact slot still free?
 *
 * `findSlots` answers "what was open a moment ago". Between offering a time and
 * the caller accepting it, another caller — or the front desk — can take it.
 * Booking on the strength of the earlier search is a lost-update race that
 * surfaces as two patients arriving for the same chair.
 */
export function slotStillFree(
  busy: BusyBlock[],
  startMs: number,
  endMs: number,
  providerId: string,
  operatoryId: string,
): boolean {
  return !busy.some(
    (b) =>
      (b.providerId === providerId || b.operatoryId === operatoryId) &&
      b.startMs < endMs &&
      startMs < b.endMs,
  )
}
