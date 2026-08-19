import type { Lang } from '@vaani/shared'

/**
 * Language detection for the register Indian callers actually speak.
 *
 * The hard case is not "Hindi or English" — it is the constant mixing:
 *
 *   "Mujhe kal morning ek appointment book karna hai."
 *   "Doctor sahab ka schedule kya hai Thursday ko?"
 *
 * Classifying that as either pure Hindi or pure English produces a reply in
 * the wrong register, which is the single most jarring thing a bilingual agent
 * can do. So Hinglish is its own label, and mixed input is detected as mixed.
 */

/**
 * High-frequency romanised Hindi function words — grammar, not vocabulary.
 *
 * Deliberately excludes `to`, `me`, and `the`: each is a real romanised Hindi
 * word ("toh", "mein", "the" = were) that is spelled identically to a very
 * common English word. Counting them makes ordinary English sentences score as
 * Hindi, which is far worse than missing a weak signal.
 */
const HINDI_MARKERS = new Set([
  'hai', 'hain', 'ho', 'hoon', 'tha', 'thi', 'ka', 'ke', 'ki', 'ko', 'se',
  'mein', 'par', 'pe', 'aur', 'ya', 'nahi', 'nahin', 'haan', 'ji',
  'mujhe', 'mera', 'meri', 'mere', 'aap', 'aapka', 'aapki', 'tum', 'main',
  'kya', 'kaun', 'kab', 'kahan', 'kaise', 'kyun', 'kitna', 'kitne', 'kuch',
  'karna', 'karni', 'karo', 'kare', 'karta', 'karti', 'chahiye', 'sakta',
  'sakti', 'raha', 'rahi', 'rahe', 'liye', 'wala', 'wali', 'bhi', 'toh',
  'abhi', 'kal', 'aaj', 'parso', 'subah', 'shaam', 'raat', 'dopahar',
  'accha', 'theek', 'thik', 'bahut', 'zyada', 'jaldi', 'dard', 'sahab',
])

/** Common English function words — the mirror-image grammatical signal. */
const ENGLISH_MARKERS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'have', 'has', 'do', 'does',
  'i', 'you', 'my', 'your', 'me', 'we', 'it', 'and', 'or', 'but', 'for', 'to',
  'of', 'in', 'on', 'at', 'with', 'want', 'need', 'can', 'could', 'would',
  'please', 'thanks', 'thank', 'yes', 'no', 'what', 'when', 'where', 'how',
])

/**
 * English content words common in this domain.
 *
 * Function words alone cannot detect Hinglish, because Hinglish keeps Hindi
 * grammar and borrows English *nouns*: "Mujhe kal morning appointment book
 * karna hai" contains no English function words at all, yet is unmistakably
 * code-switched. These borrowings are the English signal in that register.
 */
const ENGLISH_CONTENT = new Set([
  'appointment', 'appointments', 'book', 'booking', 'cancel', 'confirm',
  'reschedule', 'doctor', 'dentist', 'clinic', 'checkup', 'cleaning',
  'filling', 'crown', 'braces', 'extraction', 'surgery', 'scaling',
  'insurance', 'policy', 'payment', 'cash', 'card', 'report', 'xray',
  'morning', 'evening', 'afternoon', 'night', 'today', 'tomorrow', 'time',
  'slot', 'schedule', 'available', 'free', 'pain', 'tooth', 'teeth', 'gums',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'emergency', 'urgent', 'address', 'location', 'number', 'name', 'ok', 'okay',
])

const DEVANAGARI = /[ऀ-ॿ]/

export interface DetectionResult {
  lang: Lang
  confidence: number
  codeSwitched: boolean
}

/**
 * Detect the language of a transcript.
 *
 * @param text  the transcript
 * @param hint  the language the STT provider reported, if any
 */
export function detectLang(text: string, hint?: Lang): DetectionResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { lang: hint ?? 'en-IN', confidence: 0, codeSwitched: false }
  }

  // Devanagari script is unambiguous — no need to guess.
  const devanagariChars = (trimmed.match(/[ऀ-ॿ]/g) ?? []).length
  const latinChars = (trimmed.match(/[A-Za-z]/g) ?? []).length

  if (devanagariChars > 0 && latinChars === 0) {
    return { lang: 'hi-IN', confidence: 0.99, codeSwitched: false }
  }
  if (devanagariChars > 0 && latinChars > 0) {
    // Both scripts in one utterance is code-switching by definition.
    return { lang: 'hi-IN', confidence: 0.9, codeSwitched: true }
  }

  const words = trimmed.toLowerCase().split(/[^a-z']+/).filter(Boolean)
  if (words.length === 0) {
    return { lang: hint ?? 'en-IN', confidence: 0.3, codeSwitched: false }
  }

  let hindi = 0
  let english = 0
  for (const w of words) {
    if (HINDI_MARKERS.has(w)) hindi++
    if (ENGLISH_MARKERS.has(w) || ENGLISH_CONTENT.has(w)) english++
  }

  const signal = hindi + english
  if (signal === 0) {
    // No recognisable marker at all — usually a bare noun phrase ("root canal").
    // Keep whatever language the conversation was already in rather than guess.
    return { lang: hint ?? 'en-IN', confidence: 0.35, codeSwitched: false }
  }

  const confidence = 0.8 + Math.min(0.15, signal / 20)
  const codeSwitched = hindi > 0 && english > 0

  // Hindi grammar anywhere in the utterance decides the register — a Hindi
  // speaker borrowing English nouns is speaking Hinglish, not English.
  if (hindi > 0) {
    return { lang: 'hi-Latn-IN', confidence: codeSwitched ? confidence - 0.05 : confidence, codeSwitched }
  }
  return { lang: 'en-IN', confidence, codeSwitched: false }
}

/** True when the string contains any Devanagari. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text)
}
