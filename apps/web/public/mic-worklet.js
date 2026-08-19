/**
 * Microphone capture. That is all it does now.
 *
 * The previous worklet also ran voice activity detection, an adaptive noise
 * floor, attack/release counters and echo ducking — several hundred lines of
 * signal processing that Gemini Live performs server-side, with the model's own
 * understanding of whether what it heard was speech.
 *
 * Everything left here is: take float samples, convert to PCM16, hand them up.
 */

const FRAME = 512

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(FRAME)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true

    for (let i = 0; i < input.length; i++) {
      this.buf[this.filled++] = input[i]
      if (this.filled < FRAME) continue

      const pcm = new Int16Array(FRAME)
      for (let j = 0; j < FRAME; j++) {
        const s = Math.max(-1, Math.min(1, this.buf[j]))
        pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.port.postMessage(pcm, [pcm.buffer])
      this.filled = 0
    }
    return true
  }
}

registerProcessor('mic-processor', MicProcessor)
