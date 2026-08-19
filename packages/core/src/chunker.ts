import type { Lang } from '@vaani/shared'

/**
 * SentenceChunker — streams LLM output into TTS one clause at a time.
 *
 * Waiting for a complete LLM response before starting synthesis wastes the
 * entire generation time. Feeding TTS the first clause the moment it is
 * available typically halves perceived latency, and it is the difference
 * between "thinking…" and a receptionist who starts answering as they think.
 *
 * The first chunk is allowed to break at a comma, because getting *any* audio
 * out fast dominates prosody. After that, whole sentences only — TTS needs the
 * full clause to place stress and intonation correctly, and choppy synthesis
 * is exactly what makes an agent sound synthetic.
 */

const HARD_BOUNDARY = /[.!?।؟]/
const SOFT_BOUNDARY = /[,;:]/

/** Titles and abbreviations whose trailing dot is not a sentence end. */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'jr', 'sr',
  'no', 'vs', 'etc', 'approx', 'appt', 'ext', 'inc', 'ltd',
])

/**
 * Chunk thresholds are measured in **spoken duration, not characters**.
 *
 * What makes a fragment sound synthetic is how short the resulting audio clip
 * is — a 300 ms clip has no room for an intonation contour, and stitching such
 * clips together is *the* reason a voice agent sounds like a machine. Character
 * count is a poor proxy for that: "Done." and "नमस्ते।" are almost the same
 * length in characters and nearly three times apart in speech, because one
 * Devanagari glyph carries a whole syllable.
 *
 * So the rule is stated in the unit that actually matters.
 */

/** The first chunk may be short — getting audio out fast dominates here. */
const MIN_FIRST_MS = 400

/**
 * Once audio is flowing there is no latency pressure at all — the caller is
 * already listening — so later chunks should be whole thoughts. Splitting
 * "We have Monday at ten, or Monday at ten thirty. Which works for you?" into
 * three clips gains nothing and costs the intonation that ties them together.
 */
const MIN_REST_MS = 1500

/**
 * How much text must follow before a held soft chunk is released.
 *
 * Kept low and separate from MIN_REST_MS: this one governs *latency* (how soon
 * the first chunk goes out), where the other governs *prosody*.
 */
const MIN_TAIL_MS = 700

/**
 * Splitting at a comma is only worth it for a substantial lead-in. "Sure,"
 * saves perhaps 300 ms and costs far more than that in naturalness.
 */
const MIN_SOFT_MS = 900

/** Beyond this, emit even without a boundary rather than let latency build. */
const MAX_CHUNK = 240
const MIN_HARD_CHUNK = 4

export class SentenceChunker {
  private buf = ''
  private emitted = 0

  /**
   * A chunk split at a soft boundary, held back until enough text follows.
   *
   * Splitting "…you'd like a teeth cleaning, right?" at the comma emits a good
   * first chunk but strands "right?" — 330 ms of audio with nowhere to go.
   * Holding the split until the remainder is itself substantial guarantees the
   * tail is never a sliver, while still releasing within a token or two so the
   * latency the split was for is preserved.
   */
  private heldSoft: string | null = null

  constructor(private readonly lang: Lang = 'en-IN') {}

  /** Feed streamed text; returns any chunks now ready for synthesis. */
  push(text: string): string[] {
    this.buf += text
    // Models routinely emit "right?Great." across streaming deltas. Left as-is,
    // TTS reads it as one breathless clause with no pause. Repairing the text
    // fixes the audio regardless of where the chunk boundaries land.
    this.buf = this.buf.replace(/([.!?।])([A-Za-z\u0900-\u097F])/g, '$1 $2')
    const out: string[] = []
    let start = 0

    // Release a held chunk once what follows is long enough to stand alone.
    if (this.heldSoft && estimateDurationMs(this.buf, this.lang) >= MIN_TAIL_MS) {
      out.push(this.heldSoft)
      this.emitted++
      this.heldSoft = null
    }

    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i]!
      const hard = HARD_BOUNDARY.test(ch)
      const soft = SOFT_BOUNDARY.test(ch)
      if (!hard && !soft) continue

      const next = this.buf[i + 1]
      // A boundary at the very end of the buffer is ambiguous: "4." could be a
      // sentence end or the start of "4.30". Wait for the next token.
      if (next === undefined) break
      // "4.30", "1,200" — a dot or comma glued to a digit is a number, not a
      // boundary. Everything else still ends a sentence even without a space:
      // models routinely emit "right?Great." across streaming deltas, and
      // treating that as one clause produced audibly run-together speech.
      if ((ch === '.' || ch === ',') && /\d/.test(next)) continue

      const candidate = this.buf.slice(start, i + 1).trim()
      if (candidate.length === 0) {
        start = i + 1
        continue
      }

      if (ch === '.') {
        const word = candidate.slice(0, -1).split(/\s+/).at(-1)?.toLowerCase() ?? ''
        if (ABBREVIATIONS.has(word)) continue
      }

      // Soft boundaries buy latency on the first chunk only.
      if (soft && this.emitted > 0) continue

      const minMs = soft ? MIN_SOFT_MS : this.emitted === 0 ? MIN_FIRST_MS : MIN_REST_MS
      if (estimateDurationMs(candidate, this.lang) < minMs) continue

      if (soft) {
        // Hold rather than emit — the tail may turn out to be a sliver.
        this.heldSoft = candidate
        start = i + 1
        continue
      }

      out.push(candidate)
      this.emitted++
      start = i + 1
    }

    this.buf = this.buf.slice(start)

    // Runaway clause with no punctuation in sight — break at a word boundary
    // rather than let the caller sit in silence.
    while (this.buf.trim().length > MAX_CHUNK) {
      const slice = this.buf.slice(0, MAX_CHUNK)
      const cut = slice.lastIndexOf(' ')
      const at = cut > MIN_HARD_CHUNK ? cut : MAX_CHUNK
      const chunk = this.buf.slice(0, at).trim()
      if (chunk.length === 0) break
      out.push(chunk)
      this.emitted++
      this.buf = this.buf.slice(at)
    }

    return out
  }

  /**
   * Emit whatever is left at the end of the response.
   *
   * A held soft chunk is merged with the remainder here, so a trailing "right?"
   * is spoken as part of the sentence it belongs to rather than as its own clip.
   */
  flush(): string | null {
    const rest = this.buf.trim()
    this.buf = ''

    const held = this.heldSoft
    this.heldSoft = null

    const merged = held ? (rest ? `${held} ${rest}` : held) : rest
    if (merged.length === 0) return null
    this.emitted++
    return merged
  }

  reset(): void {
    this.buf = ''
    this.emitted = 0
    this.heldSoft = null
  }
}

// ─── Duration estimation ─────────────────────────────────────────────────────

const MS_PER_LATIN_CHAR = 55 // ≈ 180 wpm, a natural receptionist pace
const MS_PER_DEVANAGARI_CHAR = 110 // one glyph carries a whole syllable
const DEVANAGARI = /[ऀ-ॿ]/

/**
 * Rough spoken duration, used for provisional word marks.
 *
 * Some TTS providers only reveal real timings after synthesis completes, but
 * barge-in truncation needs marks from the first audio sample. Estimating up
 * front and replacing with real timings when they arrive means interruption
 * always works, and works better once the provider catches up.
 */
export function estimateDurationMs(text: string, lang: Lang): number {
  const t = text.trim()
  if (t.length === 0) return 0

  // Hindi delivery in a service register runs slightly slower than English.
  const rate = lang === 'en-IN' ? 1 : 1.05

  let ms = 0
  for (const ch of t) {
    ms += DEVANAGARI.test(ch) ? MS_PER_DEVANAGARI_CHAR : MS_PER_LATIN_CHAR
  }
  return Math.round(ms * rate)
}

/**
 * Distribute a duration across words, weighted by length.
 *
 * Approximate, but barge-in truncation only needs word-boundary resolution —
 * and an approximate mark is enormously better than no mark, which is what
 * providers without timing support would otherwise leave us with.
 */
export function deriveWordMarks(
  text: string,
  totalMs: number,
): { word: string; startMs: number; endMs: number }[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const totalChars = words.reduce((n, w) => n + w.length, 0)
  const marks: { word: string; startMs: number; endMs: number }[] = []
  let cursor = 0

  words.forEach((word, i) => {
    const isLast = i === words.length - 1
    const endMs = isLast ? totalMs : Math.round(cursor + (word.length / totalChars) * totalMs)
    marks.push({ word, startMs: Math.round(cursor), endMs })
    cursor = endMs
  })

  return marks
}
