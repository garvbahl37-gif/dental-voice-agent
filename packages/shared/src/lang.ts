import { z } from 'zod'

/**
 * Language codes are deliberately narrow.
 *
 * `hi-Latn-IN` (Hinglish — Hindi written in Latin script, freely mixed with
 * English) is a first-class member, not a fallback. It is how most Indian
 * callers actually speak: "Mujhe kal morning ek appointment book karna hai."
 * Treating it as an edge case is the most common reason voice agents feel
 * foreign to Indian users.
 */
export const LangSchema = z.enum(['en-IN', 'hi-IN', 'hi-Latn-IN'])
export type Lang = z.infer<typeof LangSchema>

export const ALL_LANGS: readonly Lang[] = ['en-IN', 'hi-IN', 'hi-Latn-IN'] as const

export const DEFAULT_LANG: Lang = 'en-IN'

/** Human-readable label, in the language itself. */
export const LANG_LABEL: Record<Lang, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'hi-Latn-IN': 'Hinglish',
}

/** Short chip label for the console UI. */
export const LANG_CHIP: Record<Lang, string> = {
  'en-IN': 'EN',
  'hi-IN': 'हि',
  'hi-Latn-IN': 'HI-EN',
}

/**
 * Which script the language is written in. Drives font selection in the
 * transcript — Devanagari needs a different stack than Latin.
 */
export function scriptOf(lang: Lang): 'latin' | 'devanagari' {
  return lang === 'hi-IN' ? 'devanagari' : 'latin'
}

/**
 * Languages that share a spoken form. Hindi and Hinglish are the same speech
 * with different transcription conventions, so a caller who spoke `hi-IN` is
 * well served by a `hi-Latn-IN` reply and vice versa. Used when selecting a
 * cached phrase — avoids a needless synthesis call.
 */
export function isSpokenSibling(a: Lang, b: Lang): boolean {
  if (a === b) return true
  const hindi: Lang[] = ['hi-IN', 'hi-Latn-IN']
  return hindi.includes(a) && hindi.includes(b)
}

export interface LangDetection {
  lang: Lang
  confidence: number
  /** True when a single utterance mixed scripts or vocabularies. */
  codeSwitched: boolean
}
