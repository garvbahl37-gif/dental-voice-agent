import type { Lang } from '@vaani/shared'

/**
 * What we know about this caller, right now.
 *
 * Two problems this solves, both from the behaviour spec.
 *
 * **§28 — don't repeat questions.** Relying on the model to notice it already
 * asked for a phone number is unreliable, and the failure is glaring: asking a
 * caller for their name three times is the single most robotic thing an agent
 * can do. Known facts live here, and the prompt is told what is already
 * captured on every turn.
 *
 * **§25 — corrections supersede.** "My budget is five thousand… actually
 * eight" must leave one value, not two. Writes overwrite, and the previous
 * value is kept only so the agent can acknowledge the change naturally.
 */

export interface CallerFact<T> {
  value: T
  /** Whether the caller has heard it read back and agreed. */
  confirmed: boolean
  /** What it was before the caller corrected it. */
  previous?: T
}

export interface CallerState {
  name?: CallerFact<string>
  phone?: CallerFact<string>
  service?: CallerFact<string>
  preferredTime?: CallerFact<string>
  reason?: CallerFact<string>
  lang: Lang
  patientId?: string
  /** Appointment ids touched this call, for reschedule and cancel. */
  appointmentIds: string[]
}

export function emptyCallerState(lang: Lang = 'en-IN'): CallerState {
  return { lang, appointmentIds: [] }
}

type FactKey = 'name' | 'phone' | 'service' | 'preferredTime' | 'reason'

/**
 * Record a fact. A different value replaces the old one and clears
 * confirmation — a corrected number has not been read back yet.
 */
export function remember(
  state: CallerState,
  key: FactKey,
  value: string,
  confirmed = false,
): CallerState {
  const existing = state[key]
  if (existing?.value === value) {
    return { ...state, [key]: { ...existing, confirmed: confirmed || existing.confirmed } }
  }
  return {
    ...state,
    [key]: { value, confirmed, previous: existing?.value },
  }
}

export function confirm(state: CallerState, key: FactKey): CallerState {
  const existing = state[key]
  if (!existing) return state
  return { ...state, [key]: { ...existing, confirmed: true } }
}

/** Was this fact just corrected? Lets the agent say "Thursday, got it." */
export function wasCorrected(state: CallerState, key: FactKey): boolean {
  return state[key]?.previous !== undefined
}

/**
 * A line for the prompt describing what is already known.
 *
 * Injected fresh on every turn so the model never has to infer it from a long
 * transcript — which is exactly where it starts asking twice.
 */
export function describeState(state: CallerState): string {
  const known: string[] = []
  const missing: string[] = []

  const label: Record<FactKey, string> = {
    name: 'name',
    phone: 'mobile number',
    service: 'treatment',
    preferredTime: 'preferred time',
    reason: 'reason for visit',
  }

  for (const key of Object.keys(label) as FactKey[]) {
    const fact = state[key]
    if (fact) known.push(`${label[key]}: ${fact.value}${fact.confirmed ? '' : ' (unconfirmed)'}`)
    else missing.push(label[key])
  }

  if (known.length === 0) return 'You have not learned anything about this caller yet.'

  const lines = [`Already known — do NOT ask for these again: ${known.join(', ')}.`]
  if (missing.length > 0) lines.push(`Still missing: ${missing.join(', ')}.`)
  return lines.join(' ')
}

// ─── Number handling (§11) ───────────────────────────────────────────────────

/** Digit words, as speech recognisers render spoken numbers. */
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  shunya: '0', ek: '1', do: '2', teen: '3', char: '4', chaar: '4',
  paanch: '5', panch: '5', cheh: '6', chhe: '6', saat: '7', aath: '8', nau: '9',
  'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4',
  'पाँच': '5', 'पांच': '5', 'छह': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
}

/**
 * Pull a phone number out of a spoken transcript.
 *
 * Recognisers render spoken digits inconsistently — "9876543210", "98765 43210",
 * "nine eight seven…" — and any of them may arrive in one turn. Normalising
 * before storage means the confirmation read-back is of the number we will
 * actually dial.
 */
export function normalisePhone(transcript: string): string | null {
  let text = transcript.toLowerCase()
  for (const [word, digit] of Object.entries(DIGIT_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit)
  }

  const digits = (text.match(/\d/g) ?? []).join('')
  if (digits.length < 10) return null

  // Indian mobile numbers are the last ten digits, after any +91 / 0 prefix.
  const last10 = digits.slice(-10)
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null
}

/**
 * Format a number for reading aloud, grouped the way Indians say them.
 *
 * "9876543210" read as one run is impossible to check against a scrap of
 * paper; "98765 43210" is how the number is written and spoken.
 */
export function speakPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return phone
  return `${d.slice(0, 5)} ${d.slice(5)}`
}
