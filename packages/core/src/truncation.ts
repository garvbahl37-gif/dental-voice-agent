import type { WordMark } from '@vaani/shared'

/**
 * Barge-in truncation — the correctness property at the heart of the voice core.
 *
 * When a caller interrupts, the agent has generated a full sentence but only
 * part of it left the speaker. Most voice agents keep the *entire* generated
 * sentence in conversation history. The agent then believes it told the caller
 * something they never heard, and every subsequent turn reasons from a false
 * record — "as I mentioned, Dr. Sharma is free Thursday" when it never got past
 * "Dr. Sharma is—".
 *
 * Given TTS word timings and how much audio actually played, this returns only
 * what the caller genuinely heard. A word cut mid-articulation is dropped: half
 * a word is not information the caller received.
 */

export interface TruncationResult {
  /** What the caller heard. Ends with an em dash when speech was cut short. */
  spoken: string
  /** What was generated but never reached the caller. Drives the UI strike-through. */
  unspoken: string
  wasTruncated: boolean
}

export function truncateToPlayed(marks: WordMark[], playedMs: number): TruncationResult {
  if (marks.length === 0) {
    return { spoken: '', unspoken: '', wasTruncated: false }
  }

  // Marks are ordered; find the first word that had not finished by the cut.
  let cut = marks.findIndex((m) => m.endMs > playedMs)
  if (cut === -1) cut = marks.length

  const heard = marks.slice(0, cut)
  const rest = marks.slice(cut)

  if (rest.length === 0) {
    return { spoken: marks.map((m) => m.word).join(' '), unspoken: '', wasTruncated: false }
  }

  const spokenWords = heard.map((m) => m.word).join(' ')
  return {
    spoken: spokenWords.length > 0 ? `${spokenWords}—` : '',
    unspoken: rest.map((m) => m.word).join(' '),
    wasTruncated: true,
  }
}

/**
 * Where a word boundary sits, for the client's gain ramp. Cutting audio exactly
 * on an interrupt produces a click that reads as a dropped call; ramping to the
 * next boundary (bounded by the ramp budget) sounds like a person stopping.
 */
export function nextBoundaryMs(marks: WordMark[], playedMs: number, maxLookaheadMs: number): number {
  const next = marks.find((m) => m.endMs > playedMs)
  if (!next) return playedMs
  return Math.min(next.endMs, playedMs + maxLookaheadMs)
}
