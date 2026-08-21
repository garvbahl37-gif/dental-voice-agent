import type { BranchHours } from '@vaani/db'

/**
 * What should happen to this call, right now.
 *
 * A dental line has three quite different jobs depending on the clock, and
 * conflating them is how a practice ends up either paying for a night
 * receptionist or leaving someone with a knocked-out tooth listening to a
 * voicemail beep:
 *
 *   **Open** — the agent answers and books.
 *   **Closed** — the agent still answers. Most after-hours calls are ordinary
 *     ("are you open tomorrow?", "can I move Thursday?") and answering them is
 *     the entire value of an agent that does not sleep. It simply cannot
 *     promise a same-day slot.
 *   **Closed and urgent** — booking stops and the emergency line is given out.
 *     That decision belongs to triage, not to the clock; the clock only decides
 *     whether the *practice* can be reached.
 *
 * There is deliberately no "voicemail" state. A patient who wanted to leave a
 * message would have hung up and sent a WhatsApp; the reason they rang is that
 * they want an answer.
 */

export type CallMode = 'open' | 'after_hours' | 'holiday'

export interface RoutingDecision {
  mode: CallMode
  /** Whether the agent may offer appointments today. */
  canBookToday: boolean
  /** Read out when triage escalates and the practice is shut. */
  emergencyPhone?: string
  /** Where a transfer request goes. Null when there is nobody to transfer to. */
  transferTo?: string
  /** Appended to the system prompt so the agent knows its own constraints. */
  note: string
}

export interface RoutingInput {
  hours: BranchHours[]
  timezone: string
  now?: Date
  emergencyPhone?: string | null
  receptionPhone?: string | null
  /** ISO dates the practice is shut — festivals, maintenance. */
  holidays?: string[]
}

/** Local wall-clock in the practice's timezone, not the server's. */
export function localParts(at: Date, timezone: string): { day: number; minutes: number; iso: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  // Intl gives 24 as midnight in some locales; normalise so 24:10 is not "later
  // than" 23:50 when comparing against closing time.
  const hour = Number(get('hour')) % 24
  return {
    day: DAYS[get('weekday')] ?? 1,
    minutes: hour * 60 + Number(get('minute')),
    iso: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

export function decideRouting(input: RoutingInput): RoutingDecision {
  const now = input.now ?? new Date()
  const { day, minutes, iso } = localParts(now, input.timezone)

  const emergencyPhone = input.emergencyPhone ?? undefined
  const transferTo = input.receptionPhone ?? undefined

  if (input.holidays?.includes(iso)) {
    return {
      mode: 'holiday',
      canBookToday: false,
      emergencyPhone,
      note: 'The practice is closed today for a holiday. You can still answer questions and book for a future day, but not for today.',
    }
  }

  const today = input.hours.filter((h) => h.day === day)
  const open = today.some((h) => minutes >= toMinutes(h.open) && minutes < toMinutes(h.close))

  if (open) {
    return {
      mode: 'open',
      canBookToday: true,
      emergencyPhone,
      transferTo,
      note: 'The practice is open right now.',
    }
  }

  return {
    mode: 'after_hours',
    canBookToday: false,
    emergencyPhone,
    // Nobody is there to take a transfer, and promising one that rings out is
    // worse than saying plainly that the desk is closed.
    transferTo: undefined,
    note: [
      'The practice is closed right now.',
      'You can still answer questions and book appointments for a future day.',
      'Do NOT offer an appointment today, and do not offer to put anyone through to a colleague — there is nobody there.',
      emergencyPhone
        ? `If this is a dental emergency, give the emergency number: ${emergencyPhone}.`
        : 'If this is a dental emergency, tell them to go to their nearest emergency dental service.',
    ].join(' '),
  }
}

/** When the branch next opens, so "we open at half nine tomorrow" is true. */
export function nextOpening(
  hours: BranchHours[],
  timezone: string,
  now = new Date(),
): { day: number; open: string; daysAhead: number } | null {
  const { day, minutes } = localParts(now, timezone)
  for (let ahead = 0; ahead < 8; ahead++) {
    const d = (day + ahead) % 7
    const slots = hours.filter((h) => h.day === d).sort((a, b) => toMinutes(a.open) - toMinutes(b.open))
    for (const s of slots) {
      if (ahead === 0 && toMinutes(s.open) <= minutes) continue
      return { day: d, open: s.open, daysAhead: ahead }
    }
  }
  return null
}
