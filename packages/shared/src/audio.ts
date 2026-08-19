/**
 * Canonical audio format for the entire pipeline: PCM16, mono, 16 kHz, LE.
 *
 * Transports transcode at their own edge — Twilio's μ-law 8 kHz never reaches
 * `core`. Keeping one format inside the pipeline means turn-taking maths,
 * word-timing marks, and barge-in truncation never have to reason about codecs.
 */
export const SAMPLE_RATE = 16_000
export const CHANNELS = 1
export const BYTES_PER_SAMPLE = 2

/** 20 ms at 16 kHz = 320 samples = 640 bytes. Matches typical VAD frame sizes. */
export const FRAME_MS = 20
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000
export const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE

export interface AudioFormat {
  sampleRate: number
  channels: number
  encoding: 'pcm16' | 'mulaw' | 'mp3' | 'opus'
}

export const CANONICAL_FORMAT: AudioFormat = {
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  encoding: 'pcm16',
}

/** Duration in milliseconds of a PCM16 mono buffer at the given sample rate. */
export function durationMs(sampleCount: number, sampleRate = SAMPLE_RATE): number {
  return (sampleCount / sampleRate) * 1000
}

/** Sample count for a duration. Rounds down to whole samples. */
export function samplesForMs(ms: number, sampleRate = SAMPLE_RATE): number {
  return Math.floor((ms / 1000) * sampleRate)
}

/**
 * Root-mean-square energy of a PCM16 frame, normalised to 0..1.
 * Used as the server-side corroborating signal for client VAD — cheap enough
 * to run on every frame.
 */
export function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i]! / 32768
    sum += s * s
  }
  return Math.sqrt(sum / frame.length)
}

/** Concatenate PCM16 chunks into one buffer. */
export function concatPcm(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
