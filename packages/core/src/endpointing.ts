import type { Lang } from '@vaani/shared'

/**
 * Adaptive endpointing — deciding when the caller has actually finished.
 *
 * A fixed silence threshold is the single biggest reason voice agents feel
 * robotic. Too short and it barges in while you are thinking; too long and it
 * leaves dead air after "yes". Neither is what a receptionist does: a person
 * waits longer after asking an open question, jumps in quickly after "yes or
 * no", and hears "my number is..." as obviously unfinished.
 *
 * Everything here is pure and synchronous, so the whole policy is unit-testable
 * without audio, timers, or a model.
 */

const BASE_MS = 600
const OPEN_QUESTION_MS = 300
const YESNO_QUESTION_MS = -150
const FILLER_MS = 400
const INCOMPLETE_MS = 500

/** Absolute floor — below this we would clip a normal breath. */
const MIN_MS = 400

/**
 * Hesitation markers. When the caller's last word is one of these, they are
 * mid-thought, not finished.
 */
const FILLERS = new Set([
  // English
  'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'like', 'so',
  // Romanised Hindi
  'matlab', 'toh', 'to', 'woh', 'wo', 'yaani', 'yani', 'aur', 'phir', 'bas',
  // Devanagari
  'मतलब', 'तो', 'वो', 'यानी', 'और', 'फिर', 'बस', 'अं', 'हम्म',
])

/**
 * Trailing tokens that leave a sentence grammatically hanging. English
 * copulas and articles, Hindi postpositions and possessives.
 */
const DANGLING: RegExp[] = [
  /\b(is|am|are|was|were|be|been|my|your|our|their|his|her|the|a|an|and|or|but|to|for|at|on|in|of|with|from)$/i,
  /\b(mera|meri|mere|aapka|aapki|hai|hain|tha|thi|ka|ke|ki|ko|se|par|pe|aur|ya|me|mein)$/i,
  /(का|के|की|को|से|पर|में|है|हैं|था|थी|मेरा|मेरी|आपका|आपकी|और|या)$/,
]

/** Indian mobile numbers are ten digits. Fewer than that is mid-recitation. */
const FULL_PHONE_DIGITS = 10

export type QuestionKind = 'open' | 'yesno' | 'none'

export interface EndpointContext {
  /** What the agent last asked — governs how long a pause is natural. */
  questionKind: QuestionKind
  /** The most recent interim transcript for this turn. */
  partialText: string
  lang: Lang
}

function lastWord(text: string): string {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean).at(-1) ?? ''
}

function endsWithFiller(text: string): boolean {
  return FILLERS.has(lastWord(text))
}

function isIncomplete(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return false
  if (DANGLING.some((re) => re.test(t))) return true

  // A digit run shorter than a full phone number, still being spoken.
  if (/\d$/.test(t)) {
    const run = t.match(/\d+$/)?.[0] ?? ''
    const digitsSoFar = (t.match(/\d/g) ?? []).length
    if (run.length > 0 && digitsSoFar < FULL_PHONE_DIGITS) return true
  }
  return false
}

/**
 * How long to wait in silence before treating the caller's turn as finished.
 */
export function silenceThresholdMs(ctx: EndpointContext): number {
  let ms = BASE_MS

  if (ctx.questionKind === 'open') ms += OPEN_QUESTION_MS
  if (ctx.questionKind === 'yesno') ms += YESNO_QUESTION_MS

  // A filler and a dangling word are the same signal; do not double-count.
  if (endsWithFiller(ctx.partialText)) ms += FILLER_MS
  else if (isIncomplete(ctx.partialText)) ms += INCOMPLETE_MS

  return Math.max(MIN_MS, ms)
}

// ─── Question classification ─────────────────────────────────────────────────

const OPEN_STARTERS = new Set([
  'how', 'what', 'when', 'where', 'which', 'why', 'who', 'tell', 'describe',
  'kaise', 'kab', 'kahan', 'kaun', 'kitna', 'kitne', 'kyun', 'kyu',
  'कैसे', 'कब', 'कहाँ', 'कहां', 'कौन', 'कितना', 'कितने', 'क्यों',
])

const YESNO_STARTERS = new Set([
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will',
  'would', 'shall', 'should', 'have', 'has', 'may', 'am',
  'kya', 'क्या',
])

/**
 * Classify the agent's own last utterance, so the next silence threshold can
 * adapt to it. Cheap heuristics only — this runs on every agent turn.
 */
export function classifyQuestion(agentUtterance: string): QuestionKind {
  const t = agentUtterance.trim()
  if (!t.endsWith('?')) return 'none'

  const first = t.toLowerCase().replace(/^[^\p{L}]+/u, '').split(/\s+/)[0] ?? ''
  if (YESNO_STARTERS.has(first)) return 'yesno'
  if (OPEN_STARTERS.has(first)) return 'open'

  // An unrecognised question shape: wait the longer time. Cutting a caller off
  // costs far more than a beat of extra silence.
  return 'open'
}
