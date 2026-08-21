import { describe, expect, it } from 'vitest'
import {
  FrameChunker,
  downsample,
  geminiOutboundToTwilio,
  mulawToPcm16,
  pcm16ToMulaw,
  twilioInboundToGemini,
  upsample,
} from './audio'

/**
 * Codec tests assert on the signal, not on the bytes.
 *
 * A μ-law implementation with an inverted sign bit still produces plausible
 * output, and a listener describes the result as "the agent sounds broken"
 * rather than "the codec is wrong". So these check the things that actually go
 * audibly wrong: sign preservation, monotonicity, round-trip error, and DC
 * offset — a codec that silently adds a bias sounds like a hum on the line.
 */

function tone(samples: number, freq: number, rate: number, amp = 8000): Int16Array {
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate))
  return out
}

describe('μ-law', () => {
  it('preserves sign', () => {
    const input = Int16Array.from([-20000, -1000, -1, 0, 1, 1000, 20000])
    const back = mulawToPcm16(pcm16ToMulaw(input))
    for (let i = 0; i < input.length; i++) {
      if (input[i]! > 100) expect(back[i]).toBeGreaterThan(0)
      if (input[i]! < -100) expect(back[i]).toBeLessThan(0)
    }
  })

  it('round-trips a tone within the format own error', () => {
    const original = tone(800, 440, 8000)
    const back = mulawToPcm16(pcm16ToMulaw(original))

    // μ-law is lossy by design — logarithmic 8-bit. What matters is that the
    // error stays proportional rather than exploding at any amplitude.
    let worst = 0
    for (let i = 0; i < original.length; i++) {
      const ref = Math.abs(original[i]!)
      if (ref < 500) continue
      worst = Math.max(worst, Math.abs(original[i]! - back[i]!) / ref)
    }
    expect(worst).toBeLessThan(0.15)
  })

  it('adds no DC offset — a bias here is an audible hum', () => {
    const original = tone(4000, 300, 8000)
    const back = mulawToPcm16(pcm16ToMulaw(original))
    const mean = back.reduce((a, b) => a + b, 0) / back.length
    expect(Math.abs(mean)).toBeLessThan(20)
  })

  it('is monotonic — louder in stays louder out', () => {
    const quiet = mulawToPcm16(pcm16ToMulaw(Int16Array.from([1000])))[0]!
    const loud = mulawToPcm16(pcm16ToMulaw(Int16Array.from([20000])))[0]!
    expect(loud).toBeGreaterThan(quiet)
  })

  it('clips rather than wrapping at full scale', () => {
    const back = mulawToPcm16(pcm16ToMulaw(Int16Array.from([32767, -32768])))
    expect(back[0]).toBeGreaterThan(20000)
    expect(back[1]).toBeLessThan(-20000)
  })
})

describe('rate conversion', () => {
  it('doubles and halves sample counts', () => {
    const src = tone(160, 440, 8000)
    expect(upsample(src, 8000, 16000)).toHaveLength(320)
    expect(downsample(tone(480, 440, 24000), 24000, 8000)).toHaveLength(160)
  })

  it('is a no-op when the rates already match', () => {
    const src = tone(64, 440, 8000)
    expect(upsample(src, 8000, 8000)).toBe(src)
    expect(downsample(src, 8000, 8000)).toBe(src)
  })

  it('preserves amplitude through 8k → 16k → 8k', () => {
    const src = tone(800, 300, 8000, 10000)
    const round = downsample(upsample(src, 8000, 16000), 16000, 8000)
    const peakIn = Math.max(...Array.from(src, Math.abs))
    const peakOut = Math.max(...Array.from(round, Math.abs))
    expect(peakOut).toBeGreaterThan(peakIn * 0.85)
  })

  it('averages when downsampling rather than dropping samples', () => {
    // A signal alternating hard between two values: nearest-sample picking
    // returns one extreme, averaging returns the middle.
    const src = Int16Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 10000 : -10000))
    const out = downsample(src, 24000, 8000)
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThan(6000)
  })
})

describe('the wire format', () => {
  it('a Twilio frame becomes 16 kHz PCM of double the length', () => {
    const mulaw = pcm16ToMulaw(tone(160, 440, 8000))
    const pcm = twilioInboundToGemini(Buffer.from(mulaw).toString('base64'))
    expect(pcm).toHaveLength(320)
  })

  it('24 kHz agent audio becomes base64 μ-law at a third of the samples', () => {
    const b64 = geminiOutboundToTwilio(tone(480, 440, 24000))
    expect(Buffer.from(b64, 'base64')).toHaveLength(160)
  })
})

describe('FrameChunker — 20 ms exactly, or Twilio stutters', () => {
  it('cuts into whole frames and carries the remainder', () => {
    const c = new FrameChunker(24000, 20) // 480 samples per frame
    expect(c.push(new Int16Array(500))).toHaveLength(1)
    // 20 left over; 460 more makes exactly one more frame.
    expect(c.push(new Int16Array(460))).toHaveLength(1)
  })

  it('never pads mid-stream — padding is an audible click per chunk', () => {
    const c = new FrameChunker(24000, 20)
    const frames = c.push(new Int16Array(479))
    expect(frames).toHaveLength(0)
    expect(c.push(new Int16Array(1))).toHaveLength(1)
  })

  it('pads only the final partial frame', () => {
    const c = new FrameChunker(24000, 20)
    c.push(new Int16Array(100))
    const tail = c.flush()
    expect(tail).toHaveLength(480)
    expect(c.flush()).toBeNull()
  })

  it('reset drops carried audio, so a barge-in cannot leak into the next turn', () => {
    const c = new FrameChunker(24000, 20)
    c.push(new Int16Array(100))
    c.reset()
    expect(c.flush()).toBeNull()
  })
})
