/**
 * Which grammatical gender the agent speaks about herself in.
 *
 * Hindi, Marathi, Punjabi and Gujarati inflect first-person verbs for the
 * speaker's own gender: a woman says "मैं कर सकती हूँ", a man "मैं कर सकता हूँ".
 * The model defaults to the masculine form, so a female voice was saying
 * masculine verbs — which every native speaker hears immediately, and which no
 * amount of accent tuning covers up.
 *
 * English, Bengali, Tamil, Telugu, Kannada and Malayalam do not inflect this
 * way, so for those there is nothing to say and nothing is said.
 */
export type VoiceGender = 'feminine' | 'masculine'

/**
 * Only the voices whose presentation is unmistakable.
 *
 * Guessing the rest from a name would be worse than the default: `Leda` is what
 * ships, so an unknown voice is assumed to present as she does, and
 * `GEMINI_LIVE_VOICE_GENDER` overrides it for anyone who changes the voice.
 */
const KNOWN: Record<string, VoiceGender> = {
  Leda: 'feminine',
  Kore: 'feminine',
  Aoede: 'feminine',
  Zephyr: 'feminine',
  Puck: 'masculine',
  Charon: 'masculine',
  Fenrir: 'masculine',
  Orus: 'masculine',
}

export function voiceGender(voice: string, override?: string): VoiceGender {
  if (override === 'feminine' || override === 'masculine') return override
  return KNOWN[voice] ?? 'feminine'
}
