import type { Lang } from '@vaani/shared'
import type { ConversationState } from './conversation-state'
import type { Appointment, PracticeStore } from './practice'

/**
 * The call record — what the front desk needs after the line drops.
 *
 * A transcript is not a record. The question a practice actually asks is "is
 * there anything for me to do about this call?", and answering it means
 * knowing who rang, what was captured, what was committed to the diary, and
 * what the agent could not finish.
 *
 * Uncertainty is preserved rather than flattened. A number the caller said but
 * never confirmed is stored as unconfirmed, because a wrong number is a patient
 * who never gets their reminder — and staff need to see which fields to check.
 */

export type CallOutcome =
  | 'booked'
  | 'rescheduled'
  | 'cancelled'
  | 'enquiry-answered'
  | 'escalated'
  | 'abandoned'
  | 'no-speech'

export interface CallRecord {
  id: string
  startedAt: string
  endedAt: string
  durationSec: number
  outcome: CallOutcome

  caller: {
    name?: string
    nameConfirmed: boolean
    phone?: string
    phoneConfirmed: boolean
    patientId?: string
    isReturning: boolean
    language: Lang
    languagesUsed: Lang[]
  }

  wanted?: string
  preferredTime?: string
  appointments: {
    id: string
    service: string
    doctor: string
    branch: string
    when: string
  }[]

  triage?: { band: 'red' | 'amber' | 'green'; reason: string }

  toolsUsed: string[]
  turns: number
  /** Anything a human still has to do. Empty is the good outcome. */
  followUps: string[]
  transcript: { speaker: 'caller' | 'priya'; text: string; at: string }[]
}

export interface RecordInput {
  sessionId: string
  startedAt: number
  state: ConversationState
  practice: PracticeStore
  bookedIds: string[]
  toolsUsed: string[]
  triage?: { band: string; reason: string }
  transcript: { speaker: 'caller' | 'priya'; text: string; at: number }[]
}

export function buildCallRecord(input: RecordInput): CallRecord {
  const { state, practice, bookedIds, toolsUsed, transcript } = input
  const endedAt = Date.now()

  const appointments = bookedIds
    .map((id) => practice.appointments.find((a) => a.id === id))
    .filter((a): a is Appointment => Boolean(a))
    .map((a) => ({
      id: a.id,
      service: practice.services.find((s) => s.id === a.serviceId)?.name ?? 'unknown',
      doctor: practice.provider(a.providerId)?.name ?? 'unknown',
      branch: practice.operatories.find((o) => o.id === a.operatoryId)?.name ?? 'unknown',
      when: new Date(a.start).toLocaleString('en-IN', {
        timeZone: process.env.PRACTICE_TIMEZONE ?? 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
      }),
    }))

  const callerTurns = transcript.filter((t) => t.speaker === 'caller').length

  const outcome: CallOutcome =
    appointments.length > 0
      ? 'booked'
      : input.triage && input.triage.band !== 'green'
        ? 'escalated'
        : callerTurns === 0
          ? 'no-speech'
          : toolsUsed.includes('search_knowledge')
            ? 'enquiry-answered'
            : 'abandoned'

  // What a human still has to do. Ordered by how much it costs to miss.
  const followUps: string[] = []
  if (input.triage?.band === 'red') {
    followUps.push(`EMERGENCY escalated — ${input.triage.reason}. Confirm the caller was reached.`)
  } else if (input.triage?.band === 'amber') {
    followUps.push(`Urgent symptom flagged — ${input.triage.reason}. Brief the doctor.`)
  }
  if (state.caller.phone && !state.caller.phone.confirmed) {
    followUps.push('Mobile number was never read back — verify before sending reminders.')
  }
  if (state.caller.name && !state.caller.name.confirmed) {
    followUps.push('Name was heard but not confirmed — check the spelling.')
  }
  if (!state.caller.phone && callerTurns > 0) {
    followUps.push('No contact number captured — this caller cannot be followed up.')
  }
  if (appointments.length === 0 && callerTurns > 2 && outcome !== 'enquiry-answered') {
    followUps.push('Caller engaged but nothing was booked — worth a callback.')
  }
  for (const [field, count] of Object.entries(state.correctionCount)) {
    if (count >= 2) followUps.push(`"${field}" was corrected ${count} times — likely misheard.`)
  }

  return {
    id: input.sessionId,
    startedAt: new Date(input.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSec: Math.round((endedAt - input.startedAt) / 1000),
    outcome,
    caller: {
      name: state.caller.name?.value,
      nameConfirmed: state.caller.name?.confirmed ?? false,
      phone: state.caller.phone?.value,
      phoneConfirmed: state.caller.phone?.confirmed ?? false,
      patientId: state.caller.patientId,
      isReturning: state.caller.isReturning,
      language: state.language,
      languagesUsed: [...new Set(state.languageHistory)],
    },
    wanted: state.service?.value,
    preferredTime: state.preferredTime?.value,
    appointments,
    triage: input.triage as CallRecord['triage'],
    toolsUsed: [...new Set(toolsUsed)],
    turns: callerTurns,
    followUps,
    transcript: transcript.map((t) => ({
      speaker: t.speaker,
      text: t.text,
      at: new Date(t.at).toISOString(),
    })),
  }
}

/**
 * Call history, in memory.
 *
 * Deliberately the shape a table-backed store would expose, so persistence is
 * a change of implementation rather than of interface. Newest first, because
 * that is the only order a front desk reads it in.
 */
export class CallLog {
  private records: CallRecord[] = []

  add(record: CallRecord): void {
    this.records.unshift(record)
    // A demo box does not need unbounded history, and unbounded history in
    // memory is how a long-running process quietly runs out of it.
    if (this.records.length > 200) this.records.length = 200
  }

  all(): CallRecord[] {
    return this.records
  }

  get(id: string): CallRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  /** Everything still needing a human, newest first. */
  outstanding(): { record: CallRecord; followUps: string[] }[] {
    return this.records
      .filter((r) => r.followUps.length > 0)
      .map((r) => ({ record: r, followUps: r.followUps }))
  }

  stats(): {
    total: number
    booked: number
    escalated: number
    needingFollowUp: number
    byLanguage: Record<string, number>
    avgDurationSec: number
  } {
    const byLanguage: Record<string, number> = {}
    for (const r of this.records) {
      byLanguage[r.caller.language] = (byLanguage[r.caller.language] ?? 0) + 1
    }
    return {
      total: this.records.length,
      booked: this.records.filter((r) => r.outcome === 'booked').length,
      escalated: this.records.filter((r) => r.outcome === 'escalated').length,
      needingFollowUp: this.records.filter((r) => r.followUps.length > 0).length,
      byLanguage,
      avgDurationSec: this.records.length
        ? Math.round(this.records.reduce((n, r) => n + r.durationSec, 0) / this.records.length)
        : 0,
    }
  }
}
