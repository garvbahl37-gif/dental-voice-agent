/**
 * The codec seam between a phone line and a speech model.
 *
 * Twilio Media Streams carry 8 kHz μ-law — the same G.711 the PSTN has used for
 * fifty years. Gemini Live listens at 16 kHz PCM16 and speaks at 24 kHz PCM16.
 * Every frame therefore crosses two conversions in each direction, and both are
 * on the critical path of a live conversation, so they are written as flat
 * loops over typed arrays with a precomputed decode table rather than anything
 * clever.
 *
 * This is worth testing to the sample. A μ-law table with an inverted sign bit
 * or an off-by-one bias still produces *audio* — it produces audio that sounds
 * like a broken radio, which is indistinguishable at a glance from "the model
 * is being weird today" and costs a day to track down.
 */

const BIAS = 0x84
const CLIP = 32635

/** μ-law is only 8 bits, so every possible input is precomputed once. */
const MULAW_DECODE = new Int16Array(256)
for (let i = 0; i < 256; i++) {
  const muVal = ~i & 0xff
  let t = (((muVal & 0x0f) << 3) + BIAS) << ((muVal & 0x70) >> 4)
  t -= BIAS
  MULAW_DECODE[i] = (muVal & 0x80) !== 0 ? -t : t
}

export function mulawToPcm16(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length)
  for (let i = 0; i < mulaw.length; i++) out[i] = MULAW_DECODE[mulaw[i]!]!
  return out
}

export function pcm16ToMulaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i]!
    const sign = (sample >> 8) & 0x80
    if (sign !== 0) sample = -sample
    if (sample > CLIP) sample = CLIP
    sample += BIAS

    let exponent = 7
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
      /* find the highest set bit */
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff
  }
  return out
}

/**
 * Rate conversion.
 *
 * Linear interpolation, deliberately. A proper polyphase filter would be more
 * faithful, but the signal here is already band-limited to 3.4 kHz by the phone
 * network — there is nothing above the Nyquist limit left to alias, so the
 * expensive filter would be protecting against a problem the PSTN already
 * solved. Downsampling to 8 kHz does need care, and that path averages rather
 * than picking nearest, which is what stops it sounding gritty.
 */
export function upsample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm
  const ratio = to / from
  const out = new Int16Array(Math.floor(pcm.length * ratio))
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio
    const lo = Math.floor(src)
    const hi = Math.min(lo + 1, pcm.length - 1)
    const frac = src - lo
    out[i] = Math.round(pcm[lo]! * (1 - frac) + pcm[hi]! * frac)
  }
  return out
}

export function downsample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm
  const ratio = from / to
  const out = new Int16Array(Math.floor(pcm.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), pcm.length)
    // Average the window rather than taking one sample: picking nearest throws
    // away most of the energy and the result sounds thin and gritty.
    let sum = 0
    for (let j = start; j < end; j++) sum += pcm[j]!
    const n = Math.max(1, end - start)
    out[i] = Math.round(sum / n)
  }
  return out
}

export const TWILIO_RATE = 8_000
export const GEMINI_IN_RATE = 16_000
export const GEMINI_OUT_RATE = 24_000

/** A caller's frame, on its way to the model. */
export function twilioInboundToGemini(payloadB64: string): Int16Array {
  const bytes = Buffer.from(payloadB64, 'base64')
  return upsample(mulawToPcm16(bytes), TWILIO_RATE, GEMINI_IN_RATE)
}

/** The agent's frame, on its way to the phone. */
export function geminiOutboundToTwilio(pcm: Int16Array): string {
  return Buffer.from(pcm16ToMulaw(downsample(pcm, GEMINI_OUT_RATE, TWILIO_RATE))).toString('base64')
}

/**
 * Twilio expects 20 ms of audio per message — 160 μ-law bytes at 8 kHz.
 *
 * Gemini emits whatever length it likes. Sending those straight through makes
 * playback stutter, because Twilio paces its own jitter buffer on frame size,
 * so the stream is re-cut into exact 20 ms frames and the remainder is carried
 * to the next chunk rather than padded with silence — padding inserts an
 * audible click at every chunk boundary.
 */
export class FrameChunker {
  private carry: Int16Array = new Int16Array(0)
  /** 20 ms at the source rate, before downsampling. */
  private readonly frameSamples: number

  constructor(sourceRate = GEMINI_OUT_RATE, frameMs = 20) {
    this.frameSamples = Math.round((sourceRate * frameMs) / 1000)
  }

  push(pcm: Int16Array): Int16Array[] {
    const joined = new Int16Array(this.carry.length + pcm.length)
    joined.set(this.carry, 0)
    joined.set(pcm, this.carry.length)

    const frames: Int16Array[] = []
    let offset = 0
    while (offset + this.frameSamples <= joined.length) {
      frames.push(joined.subarray(offset, offset + this.frameSamples))
      offset += this.frameSamples
    }
    this.carry = joined.slice(offset)
    return frames
  }

  /** Anything left when the turn ends, padded to a whole frame. */
  flush(): Int16Array | null {
    if (this.carry.length === 0) return null
    const out = new Int16Array(this.frameSamples)
    out.set(this.carry, 0)
    this.carry = new Int16Array(0)
    return out
  }

  reset(): void {
    this.carry = new Int16Array(0)
  }
}
