/**
 * Rejects transcripts Whisper invents out of silence.
 *
 * Whisper was trained on subtitled video, and given silence or room tone it
 * does not return nothing — it returns the things that appear over silence in
 * its training data: channel sign-offs, subtitle credits, "Thank you.", a URL.
 * Left unfiltered these enter the conversation as caller turns, and the agent
 * answers them. That is the difference between an agent that seems not to
 * understand you and one that is faithfully replying to "www.pens.com.au".
 *
 * Two independent gates, because either alone is porous:
 *
 *   1. **Energy** — silence cannot contain speech, whatever the model returns.
 *      This is the reliable one, and it runs before the network call.
 *   2. **Pattern** — the known stock phrases, for the case where real room
 *      noise carries enough energy to pass the first gate.
 */

/**
 * Minimum RMS for a buffer to plausibly contain speech.
 *
 * Set below normal speech but above room tone. Erring low is safe: a quiet
 * caller who slips through still gets transcribed, whereas a high threshold
 * silently drops real speech, which is far worse.
 */
const SPEECH_RMS_FLOOR = 0.008

/** Fraction of frames that must carry speech-level energy. */
const MIN_VOICED_RATIO = 0.12

/**
 * Absolute minimum voiced audio before transcription is worth attempting.
 *
 * A ratio alone is not enough: 6 % of a two-second buffer is 120 ms, which a
 * cough, a door, or one syllable of television comfortably clears. A caller
 * turn — even "yes" — carries more voiced audio than this. Below it there is
 * nothing to transcribe, and asking anyway is how "Thank you." ends up in the
 * conversation as something the caller said.
 */
const MIN_VOICED_MS = 400

/**
 * Stock phrases Whisper emits over silence. Matched on the *whole* transcript
 * only — "thank you" mid-sentence is ordinary speech and must survive.
 */
const HALLUCINATIONS: RegExp[] = [
  /^thank you[.!]?$/i,
  /^thanks for watching[.!]?$/i,
  /^thank you for watching[.!]?$/i,
  /^please subscribe.*$/i,
  /^subscribe to.*$/i,
  /^(sub)?titles? by.*$/i,
  /^subtitles? provided by.*$/i,
  /^www\.[^\s]+$/i,
  /^https?:\/\/\S+$/i,
  /^[^\s]+\.(com|net|org|au|co\.uk|in)$/i,
  /^bye[.!]?$/i,
  /^you[.!]?$/i,
  /^\.+$/,
  /^\[.*\]$/,
  /^\(.*\)$/,
  /^music$/i,
  /^applause$/i,
  /^silence$/i,
  /^श्रेय.*$/,
  /^धन्यवाद[।.]?$/,

  // Measured, not guessed. These are what Groq's whisper-large-v3-turbo
  // actually returned from a silent microphone during a real browser session:
  // subtitle credits in three languages, and video-editing chapter markers.
  /^sous-titrage.*$/i,
  /^sous-titres.*$/i,
  /^amara\.org.*$/i,
  /^transcri(ption|bed).*$/i,
  /^outro( music)?[.!]?$/i,
  /^intro( music)?[.!]?$/i,
  /^\s*♪.*$/,
  /^(birds?|wind|rain|noise|static|beep|ringing)[\s\w]{0,12}$/i,
  /^merci( d'avoir regardé.*)?[.!]?$/i,
  /^untertitel.*$/i,
  /^字幕.*$/,
  /^視聴.*$/,
  /^end of (video|recording|transcript).*$/i,
  /^copyright.*$/i,
  /^all rights reserved.*$/i,
]

/**
 * Languages this agent actually speaks.
 *
 * Whisper hallucinates in whatever language its training data used over
 * silence — French subtitle credits are common. A transcript in a language
 * the caller cannot be speaking is not a transcription error, it is an
 * invention, and it should never enter the conversation.
 */
const IMPLAUSIBLE_SCRIPT = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/

/** Does this buffer plausibly contain speech at all? */
export function hasSpeechEnergy(pcm: Int16Array, frameSize = 320): boolean {
  if (pcm.length < frameSize) return false

  let voiced = 0
  let frames = 0

  for (let offset = 0; offset + frameSize <= pcm.length; offset += frameSize) {
    let sum = 0
    for (let i = 0; i < frameSize; i++) {
      const s = (pcm[offset + i] ?? 0) / 32768
      sum += s * s
    }
    if (Math.sqrt(sum / frameSize) > SPEECH_RMS_FLOOR) voiced++
    frames++
  }

  if (frames === 0) return false

  const voicedMs = (voiced * frameSize * 1000) / 16_000
  return voicedMs >= MIN_VOICED_MS && voiced / frames >= MIN_VOICED_RATIO
}

/**
 * Fragments the decoder produces from the attack of a word, or from a cough.
 *
 * A caller's opening turn is never two letters and a full stop. "SMA, Cp." is
 * Whisper resolving a partial syllable into initials — plausible-looking text
 * with no speech behind it. Anything this short, with this little vowel
 * structure, is noise being spelled out.
 */
function isNoiseFragment(t: string): boolean {
  const letters = (t.match(/\p{L}/gu) ?? []).length
  if (letters >= 8) return false

  // Two characters or fewer of actual content is not an utterance.
  const alnum = t.replace(/[^\p{L}\p{N}]/gu, '')
  if (alnum.length <= 2) return true

  // Short and mostly capitals reads as initials, which is how the decoder
  // spells out a sound it could not resolve into a word. Real speech runs
  // around one capital in ten letters; "SMA, Cp." runs four in five.
  const upper = (t.match(/\p{Lu}/gu) ?? []).length
  if (letters > 0 && upper / letters > 0.5) return true

  return false
}

/** Is this transcript one of Whisper's stock inventions? */
export function isHallucination(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return true
  // A very short transcript with no letters is noise, not speech.
  if (!/[\p{L}]/u.test(t)) return true
  if (isNoiseFragment(t)) return true
  // CJK, Arabic or Cyrillic cannot be a caller speaking English, Hindi or
  // Hinglish — the recogniser has invented it.
  if (IMPLAUSIBLE_SCRIPT.test(t)) return true
  return HALLUCINATIONS.some((p) => p.test(t))
}

/**
 * Both gates together. Returns the transcript, or an empty string when the
 * audio could not have contained it.
 */
export function acceptTranscript(text: string, pcm: Int16Array | null): string {
  if (isHallucination(text)) return ''
  if (pcm && !hasSpeechEnergy(pcm)) return ''
  return text
}
