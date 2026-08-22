import { z } from 'zod'

/**
 * The languages a caller may actually ring in.
 *
 * `hi-Latn-IN` (Hinglish — Hindi written in Latin script, freely mixed with
 * English) is a first-class member, not a fallback. It is how most Indian
 * callers actually speak: "Mujhe kal morning ek appointment book karna hai."
 * Treating it as an edge case is the most common reason voice agents feel
 * foreign to Indian users.
 *
 * The regional languages are here because a Mumbai practice takes calls in
 * Marathi and Gujarati every day, and a Chennai or Kochi practice takes almost
 * none in Hindi. Each was verified against Gemini Live rather than assumed:
 * every one below returns audio in its own script with its own accent, and
 * Marathi comes back as Marathi ("मी तुमची मदत कशी करू शकतो?") rather than the
 * Hindi that shares its alphabet.
 */
export const LangSchema = z.enum([
  'en-IN',
  'hi-IN',
  'hi-Latn-IN',
  'mr-IN',
  'gu-IN',
  'bn-IN',
  'ta-IN',
  'te-IN',
  'kn-IN',
  'ml-IN',
  'pa-IN',
])
export type Lang = z.infer<typeof LangSchema>

export const ALL_LANGS: readonly Lang[] = [
  'en-IN',
  'hi-IN',
  'hi-Latn-IN',
  'mr-IN',
  'gu-IN',
  'bn-IN',
  'ta-IN',
  'te-IN',
  'kn-IN',
  'ml-IN',
  'pa-IN',
] as const

export const DEFAULT_LANG: Lang = 'en-IN'

/** Named in the language itself — nobody looks for their language in English. */
export const LANG_LABEL: Record<Lang, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'hi-Latn-IN': 'Hinglish',
  'mr-IN': 'मराठी',
  'gu-IN': 'ગુજરાતી',
  'bn-IN': 'বাংলা',
  'ta-IN': 'தமிழ்',
  'te-IN': 'తెలుగు',
  'kn-IN': 'ಕನ್ನಡ',
  'ml-IN': 'മലയാളം',
  'pa-IN': 'ਪੰਜਾਬੀ',
}

/** The English name too, for anyone who cannot read the script yet. */
export const LANG_ENGLISH: Record<Lang, string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'hi-Latn-IN': 'Hinglish',
  'mr-IN': 'Marathi',
  'gu-IN': 'Gujarati',
  'bn-IN': 'Bengali',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'pa-IN': 'Punjabi',
}

export const LANG_CHIP: Record<Lang, string> = {
  'en-IN': 'EN',
  'hi-IN': 'हि',
  'hi-Latn-IN': 'HI-EN',
  'mr-IN': 'मरा',
  'gu-IN': 'ગુજ',
  'bn-IN': 'বাং',
  'ta-IN': 'தமி',
  'te-IN': 'తెలు',
  'kn-IN': 'ಕನ್',
  'ml-IN': 'മല',
  'pa-IN': 'ਪੰਜ',
}

export type Script =
  | 'latin'
  | 'devanagari'
  | 'gujarati'
  | 'bengali'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam'
  | 'gurmukhi'

/**
 * Which script the language is written in.
 *
 * Drives font selection in the transcript. Each of these needs its own family
 * and its own line-height — rendering Tamil or Malayalam in a Latin stack
 * produces tofu or badly stacked vowel signs, which reads as a broken app
 * rather than a font problem.
 */
export const LANG_SCRIPT: Record<Lang, Script> = {
  'en-IN': 'latin',
  'hi-Latn-IN': 'latin',
  'hi-IN': 'devanagari',
  'mr-IN': 'devanagari',
  'gu-IN': 'gujarati',
  'bn-IN': 'bengali',
  'ta-IN': 'tamil',
  'te-IN': 'telugu',
  'kn-IN': 'kannada',
  'ml-IN': 'malayalam',
  'pa-IN': 'gurmukhi',
}

export function scriptOf(lang: Lang): Script {
  return LANG_SCRIPT[lang]
}

/** The BCP-47 tag for `lang=` in HTML, so the browser picks the right font. */
export function htmlLang(lang: Lang): string {
  return lang === 'hi-Latn-IN' ? 'hi-Latn' : lang.split('-')[0]!
}

/**
 * Unicode blocks, for deciding what a caller actually wrote.
 *
 * Hindi and Marathi share Devanagari, so script alone cannot separate them —
 * that distinction is made by the words, not the alphabet.
 */
export const SCRIPT_RANGES: Record<Exclude<Script, 'latin'>, RegExp> = {
  devanagari: /[ऀ-ॿ]/,
  gujarati: /[઀-૿]/,
  bengali: /[ঀ-৿]/,
  tamil: /[஀-௿]/,
  telugu: /[ఀ-౿]/,
  kannada: /[ಀ-೿]/,
  malayalam: /[ഀ-ൿ]/,
  gurmukhi: /[਀-੿]/,
}

/**
 * Languages that share a spoken form.
 *
 * Hindi and Hinglish are the same speech with different transcription
 * conventions, so a caller who spoke `hi-IN` is well served by a `hi-Latn-IN`
 * reply and vice versa.
 */
export function isSpokenSibling(a: Lang, b: Lang): boolean {
  if (a === b) return true
  const hindi: Lang[] = ['hi-IN', 'hi-Latn-IN']
  return hindi.includes(a) && hindi.includes(b)
}

/**
 * Which accent to pin at connect.
 *
 * `speechConfig.languageCode` can only be set when the session opens, and it is
 * what stops the model reading Tamil with an English mouth. Hinglish takes the
 * Hindi accent because that is what Hinglish *is* — Hindi speech that happens
 * to borrow English words.
 */
export function accentFor(lang: Lang): string {
  return lang === 'hi-Latn-IN' ? 'hi-IN' : lang
}

export interface LangDetection {
  lang: Lang
  confidence: number
  /** True when a single utterance mixed scripts or vocabularies. */
  codeSwitched: boolean
}
