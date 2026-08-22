import type { Lang } from '@vaani/shared'

/**
 * How the call went, from the caller's side.
 *
 * Rules over a model, for the same reason triage is: this feeds a dashboard a
 * practice acts on, and a number that is right most of the time is worse than
 * no number — it gets trusted. A lexicon is dull, explainable, costs nothing,
 * and when it is wrong the reason is visible in the matched words.
 *
 * It reads **the caller's turns only**. The agent is trained to sound warm
 * whatever is happening, so including its side reliably reports a furious call
 * as pleasant.
 *
 * Hinglish matters here more than in most places: an unhappy Indian caller is
 * as likely to say "bakwas" or "bahut kharab" as anything English, and a
 * lexicon that misses those calls every angry patient neutral.
 */

export type Sentiment = 'positive' | 'neutral' | 'negative'

const NEGATIVE = [
  // English
  'angry', 'annoy', 'ridiculous', 'unacceptable', 'terrible', 'awful', 'worst',
  'rude', 'useless', 'waste', 'disappoint', 'frustrat', 'complain', 'never again',
  'still waiting', 'nobody', 'no one', 'again and again', 'fed up', 'poor service',
  'overcharg', 'wrong', 'refund', 'manager', 'in charge', 'sue', 'legal',
  // Hinglish / Hindi
  'bakwas', 'bekar', 'kharab', 'galat', 'pareshan', 'gussa', 'shikayat',
  'बकवास', 'बेकार', 'खराब', 'गलत', 'परेशान', 'शिकायत', 'गुस्सा',
]

const POSITIVE = [
  'thank', 'thanks', 'thankyou', 'great', 'lovely', 'perfect', 'wonderful',
  'appreciate', 'helpful', 'excellent', 'brilliant', 'kind', 'good service',
  'dhanyavad', 'shukriya', 'accha', 'badhiya', 'theek hai',
  'धन्यवाद', 'शुक्रिया', 'अच्छा', 'बढ़िया',
]

/** Distress is not the same as dissatisfaction, and must not be counted as it. */
const DISTRESS = [
  'pain', 'hurts', 'hurting', 'bleeding', 'swollen', 'swelling', 'emergency',
  'dard', 'sujan', 'khoon', 'दर्द', 'सूजन', 'खून',
]

export interface SentimentResult {
  sentiment: Sentiment
  /** −1 to 1. Not a probability; a direction with a magnitude. */
  score: number
  /** What matched, so a surprising result can be checked rather than believed. */
  signals: string[]
  /** In pain rather than displeased. Routed differently on a dashboard. */
  distressed: boolean
}

export function analyseSentiment(
  callerTurns: string[],
  _lang?: Lang,
): SentimentResult {
  const text = callerTurns.join(' ').toLowerCase()
  if (!text.trim()) {
    return { sentiment: 'neutral', score: 0, signals: [], distressed: false }
  }

  const signals: string[] = []
  let score = 0

  for (const word of NEGATIVE) {
    if (text.includes(word)) {
      score -= 1
      signals.push(`−${word}`)
    }
  }
  for (const word of POSITIVE) {
    if (text.includes(word)) {
      score += 1
      signals.push(`+${word}`)
    }
  }

  const distressed = DISTRESS.some((w) => text.includes(w))

  // Normalised by how much was said, so one complaint in a long call is not
  // scored the same as a call that was nothing but complaint.
  const words = Math.max(10, text.split(/\s+/).length)
  const normalised = Math.max(-1, Math.min(1, score / Math.sqrt(words / 10)))

  let sentiment: Sentiment = 'neutral'
  if (normalised <= -0.5) sentiment = 'negative'
  else if (normalised >= 0.5) sentiment = 'positive'

  return {
    sentiment,
    score: Number(normalised.toFixed(2)),
    signals: signals.slice(0, 8),
    distressed,
  }
}

/**
 * Why they rang, in one word.
 *
 * Coarse on purpose. A practice wants to know that a third of calls are people
 * trying to reschedule; a twenty-category taxonomy is harder to act on and
 * harder to get right.
 */
export type CallIntent =
  | 'book'
  | 'reschedule'
  | 'cancel'
  | 'question'
  | 'emergency'
  | 'complaint'
  | 'unknown'

const INTENT_RULES: Array<[CallIntent, RegExp]> = [
  ['emergency', /\b(emergency|urgent|bleeding|swollen|swelling|knocked out|accident|khoon|sujan|दर्द|सूजन)\b/i],
  ['complaint', /\b(complain|complaint|manager|in charge|refund|overcharg|ridiculous|unacceptable|shikayat|शिकायत)\b/i],
  ['cancel', /\b(cancel|cancelling|can'?t make it|not able to come|cancel kar)\b/i],
  ['reschedule', /\b(reschedule|move|change (my|the) appointment|postpone|another time|badal)\b/i],
  ['book', /\b(book|appointment|slot|available|schedule|chahiye|karwana|लेना|अपॉइंटमेंट)\b/i],
  ['question', /\b(how much|price|cost|open|timing|hours|where|insurance|parking|kitna|kahan|kitne)\b/i],
]

export function detectIntent(callerTurns: string[]): CallIntent {
  const text = callerTurns.join(' ')
  if (!text.trim()) return 'unknown'
  // Ordered by consequence: an emergency mentioned alongside a booking request
  // is an emergency.
  for (const [intent, re] of INTENT_RULES) {
    if (re.test(text)) return intent
  }
  return 'unknown'
}
