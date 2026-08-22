import type { Lang } from '@vaani/shared'
import { normalisePhone } from './caller-state'

/**
 * What the agent knows right now — PRD §3.
 *
 * The model is never asked to remember. It is told.
 *
 * A transcript is a poor memory: a fact stated twenty turns ago competes with
 * everything since, and attention to it decays exactly when a long call needs
 * it most. So the conversation keeps an explicit typed record, and that record
 * is rendered into the instructions on every single turn.
 *
 * Nothing here is written by the model. Facts arrive from tool results and from
 * a deterministic extractor over caller transcripts. Asking a model to maintain
 * its own memory reintroduces the unreliability this exists to remove.
 */

export interface Fact<T> {
  value: T
  /** Read back to the caller and agreed. */
  confirmed: boolean
  /** Database-sourced facts never need confirming; heard ones do. */
  source: 'caller' | 'lookup'
  turnLearned: number
}

export type Intent = 'book' | 'reschedule' | 'cancel' | 'enquiry' | 'emergency' | 'unclear'

export interface ConversationState {
  turn: number

  caller: {
    name?: Fact<string>
    phone?: Fact<string>
    patientId?: string
    isReturning: boolean
  }

  intent?: Intent
  service?: Fact<string>
  preferredTime?: Fact<string>
  preferredDoctor?: Fact<string>
  branch?: Fact<string>

  /** Things the agent has said out loud, so it never repeats itself. */
  questionsAsked: string[]
  offeredSlots: { start: string; when: string }[]
  declinedSlots: string[]
  bookedAppointments: string[]

  language: Lang
  languageHistory: Lang[]

  correctionCount: Record<string, number>
}

export function newConversation(lang: Lang = 'en-IN'): ConversationState {
  return {
    turn: 0,
    caller: { isReturning: false },
    questionsAsked: [],
    offeredSlots: [],
    declinedSlots: [],
    bookedAppointments: [],
    language: lang,
    languageHistory: [lang],
    correctionCount: {},
  }
}

type FactKey = 'name' | 'phone' | 'service' | 'preferredTime' | 'preferredDoctor' | 'branch'

function readFact(s: ConversationState, key: FactKey): Fact<string> | undefined {
  return key === 'name' || key === 'phone' ? s.caller[key] : (s[key] as Fact<string> | undefined)
}

function writeFact(s: ConversationState, key: FactKey, fact: Fact<string> | undefined): void {
  if (key === 'name' || key === 'phone') s.caller[key] = fact
  else (s as unknown as Record<string, Fact<string> | undefined>)[key] = fact
}

/**
 * Record a fact. A different value replaces the old one and clears confirmation
 * — a corrected number has not been read back yet.
 */
export function learn(
  s: ConversationState,
  key: FactKey,
  value: string,
  source: 'caller' | 'lookup' = 'caller',
): ConversationState {
  const existing = readFact(s, key)

  if (existing?.value === value) return s

  if (existing) s.correctionCount[key] = (s.correctionCount[key] ?? 0) + 1

  writeFact(s, key, {
    value,
    // The database does not need the caller's agreement.
    confirmed: source === 'lookup',
    source,
    turnLearned: s.turn,
  })
  return s
}

export function markConfirmed(s: ConversationState, key: FactKey): ConversationState {
  const f = readFact(s, key)
  if (f) writeFact(s, key, { ...f, confirmed: true })
  return s
}

/** Has the agent already asked this? Prevents the repeated-question failure. */
export function alreadyAsked(s: ConversationState, question: string): boolean {
  return s.questionsAsked.includes(question)
}

export function noteAsked(s: ConversationState, question: string): ConversationState {
  if (!s.questionsAsked.includes(question)) s.questionsAsked.push(question)
  return s
}

/**
 * Adopt a language, with hysteresis — PRD §5.1.
 *
 * A single ambiguous turn must not flip the conversation. "Yes" and "haan" are
 * both plausible in either register, and flipping on them makes the agent
 * oscillate. Devanagari is unambiguous and switches immediately; anything else
 * needs two consecutive turns to agree.
 */
/** Sure enough to act on a single utterance. */
const CONFIDENT = 0.85

export function observeLanguage(
  s: ConversationState,
  detected: Lang,
  confidence: number,
): ConversationState {
  s.languageHistory.push(detected)

  if (detected === s.language) return s

  /**
   * Confident detections are acted on at once, whichever language they name.
   *
   * This used to be a fast path for Hindi alone, with everything else needing
   * the same language twice in a row. That made the state a one-way ratchet:
   * a caller could be moved into Hindi by one sentence but needed two to get
   * out, so a caller who asked in Hindi for Punjabi, then asked in English for
   * English, was still recorded as speaking Hindi — and since the prompt is
   * built from this state, the agent drifted back to Hindi while the caller was
   * speaking English.
   *
   * The detector already reports how sure it is, and it is just as sure about
   * English or Punjabi as about Hindi. Ambiguity belongs in that number, not in
   * a list of favoured languages.
   */
  if (confidence > CONFIDENT) {
    s.language = detected
    return s
  }

  // Below that, the same reading twice — one uncertain guess should not move a
  // call that is going fine.
  const recent = s.languageHistory.slice(-2)
  if (recent.length === 2 && recent[0] === detected && recent[1] === detected) {
    s.language = detected
  }
  return s
}

/**
 * Render the state into the instruction block — PRD §3.4.
 *
 * Short and explicit. This text is the difference between an agent that
 * remembers and one that asks for your name three times.
 */
export function describeConversation(s: ConversationState): string {
  const lines: string[] = []
  const known: string[] = []

  const label: Record<FactKey, string> = {
    name: 'Name',
    phone: 'Mobile',
    service: 'Wants',
    preferredTime: 'Prefers',
    preferredDoctor: 'Doctor',
    branch: 'Branch',
  }

  for (const key of Object.keys(label) as FactKey[]) {
    const f = readFact(s, key)
    if (!f) continue
    const status = f.confirmed ? '' : ' (NOT yet read back)'
    known.push(`${label[key]}: ${f.value}${status}`)
  }

  if (s.caller.isReturning) known.push('This is an existing patient')

  lines.push(
    known.length > 0
      ? `WHAT YOU ALREADY KNOW\n  ${known.join('\n  ')}`
      : 'WHAT YOU ALREADY KNOW\n  Nothing yet — this caller has told you nothing so far.',
  )

  if (s.questionsAsked.length > 0) {
    lines.push(`You have ALREADY asked for: ${s.questionsAsked.join(', ')}. Do not ask again.`)
  }

  if (s.offeredSlots.length > 0) {
    lines.push(`You have offered: ${s.offeredSlots.map((o) => o.when).join('; ')}.`)
  }
  if (s.declinedSlots.length > 0) {
    lines.push(`They declined these — never offer them again: ${s.declinedSlots.join('; ')}.`)
  }
  if (s.bookedAppointments.length > 0) {
    lines.push(`Already booked this call: ${s.bookedAppointments.length} appointment(s).`)
  }

  const unconfirmed = (Object.keys(label) as FactKey[])
    .filter((k) => {
      const f = readFact(s, k)
      return f && !f.confirmed && (k === 'phone' || k === 'name')
    })
    .map((k) => label[k])

  if (unconfirmed.length > 0) {
    lines.push(`Read back before booking: ${unconfirmed.join(', ')}.`)
  }

  return lines.join('\n')
}

// ─── Slot extraction (PRD §3.3) ──────────────────────────────────────────────

/**
 * Time hints, split by kind.
 *
 * A day and a time-of-day are different facts and must compose: "Thursday
 * morning" is more specific than either. Returning whichever matched first
 * meant "Actually Thursday morning" extracted only "morning" — identical to
 * the previous turn, so the correction was never recorded.
 */
const DAY_HINTS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'somvar', 'mangalvar', 'budhvar', 'guruvar', 'shukravar', 'shanivar',
  'today', 'tomorrow', 'kal', 'parso', 'aaj', 'next week', 'agle hafte', 'this week',
]

const PERIOD_HINTS = ['morning', 'afternoon', 'evening', 'night', 'subah', 'shaam', 'dopahar', 'raat']

/** Words that follow "I am" or "this is" without being a name. */
const NOT_NAMES = new Set([
  'fine', 'good', 'well', 'okay', 'calling', 'here', 'urgent', 'sorry',
  'looking', 'trying', 'just', 'not', 'the', 'a', 'an', 'from', 'about',
])

const NAME_PATTERNS = [
  /(?:my name is|i am|i'm|this is|myself)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  /(?:mera naam|naam hai|main)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
]

export interface Extracted {
  name?: string
  phone?: string
  preferredTime?: string
}

/**
 * Pull facts out of what the caller actually said.
 *
 * Deliberately conservative: a wrong extraction becomes a fact the agent
 * confidently repeats back, which is worse than not extracting at all.
 */
export function extractFacts(transcript: string): Extracted {
  const out: Extracted = {}

  const phone = normalisePhone(transcript)
  if (phone) out.phone = phone

  for (const p of NAME_PATTERNS) {
    const m = transcript.match(p)
    const captured = m?.[1]?.trim()
    if (!captured) continue

    // The trigger is matched case-insensitively, so the capture must be
    // validated for capitalisation separately — otherwise "I am calling
    // about..." yields "calling about" as the caller's name, and the agent
    // confidently reads it back.
    if (!/^\p{Lu}\p{Ll}+/u.test(captured)) continue
    if (captured.length < 3) continue
    if (NOT_NAMES.has(captured.split(/\s+/)[0]!.toLowerCase())) continue

    out.name = captured
    break
  }

  const lower = transcript.toLowerCase()
  const day = DAY_HINTS.find((h) => lower.includes(h))
  const period = PERIOD_HINTS.find((h) => lower.includes(h))
  const clock = transcript.match(/\b\d{1,2}\s*(?::|\.)\s*\d{2}\s*(am|pm|baje)?\b/i)?.[0]
    ?? transcript.match(/\b\d{1,2}\s*(am|pm|baje)\b/i)?.[0]

  const composed = [day, period, clock?.trim()].filter(Boolean).join(' ')
  if (composed) out.preferredTime = composed

  return out
}
