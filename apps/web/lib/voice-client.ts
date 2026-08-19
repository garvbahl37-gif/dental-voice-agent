import type { ClientEvent, ServerEvent } from '@vaani/shared'

/**
 * The browser half of a Vaani call.
 *
 * Much smaller than it was, because Gemini Live took over the hard parts.
 * There is no VAD here, no endpointing, no barge-in truncation and no playback
 * position reporting — Live decides when the caller has started and stopped
 * speaking, and tells us when it has been interrupted.
 *
 * What remains: capture the microphone at 16 kHz, play what comes back at
 * 24 kHz gaplessly, and flush the queue the moment the caller cuts in.
 */

const MIC_RATE = 16_000
const PLAYBACK_RATE = 24_000
const DUCK_RAMP_MS = 60

export interface VoiceClientHandlers {
  onEvent: (event: ServerEvent) => void
  onLevel: (mic: number, agent: number) => void
  onStatus: (status: 'idle' | 'connecting' | 'live' | 'ended' | 'error') => void
}

export class VoiceClient {
  private ws: WebSocket | null = null
  private micCtx: AudioContext | null = null
  private playCtx: AudioContext | null = null
  private stream: MediaStream | null = null
  private worklet: AudioWorkletNode | null = null

  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private micAnalyser: AnalyserNode | null = null

  /** Monotonic playback cursor. Never reset per utterance — that overlapped audio. */
  private nextStartAt = 0
  private scheduled: AudioBufferSourceNode[] = []
  private levelFrame: number | null = null

  constructor(
    private readonly url: string,
    private readonly handlers: VoiceClientHandlers,
  ) {}

  async connect(): Promise<void> {
    this.handlers.onStatus('connecting')
    try {
      await this.open()
    } catch (err) {
      // Partial setup leaks the microphone light and two AudioContexts, and the
      // browser caps how many a page may hold. A failed call must leave nothing
      // behind, or the second attempt fails for a different reason than the first.
      await this.teardown()
      this.handlers.onStatus('error')
      throw err
    }
  }

  private async teardown(): Promise<void> {
    if (this.levelFrame !== null) cancelAnimationFrame(this.levelFrame)
    this.levelFrame = null
    try { this.worklet?.disconnect() } catch { /* not connected */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    try { await this.micCtx?.close() } catch { /* already closed */ }
    try { await this.playCtx?.close() } catch { /* already closed */ }
    try { this.ws?.close() } catch { /* already closed */ }
    this.worklet = null
    this.stream = null
    this.micCtx = null
    this.playCtx = null
    this.ws = null
  }

  private async open(): Promise<void> {

    // Echo cancellation still matters: most callers are on speakers, and Live's
    // turn detection is listening to whatever the microphone sends.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })

    // Two contexts: Live listens at 16 kHz and speaks at 24 kHz. Running one
    // context at a single rate would resample one direction unnecessarily.
    const micCtx = new AudioContext({ sampleRate: MIC_RATE })
    this.micCtx = micCtx
    await micCtx.audioWorklet.addModule('/mic-worklet.js')

    const source = micCtx.createMediaStreamSource(this.stream)
    this.micAnalyser = micCtx.createAnalyser()
    this.micAnalyser.fftSize = 256
    source.connect(this.micAnalyser)

    const worklet = new AudioWorkletNode(micCtx, 'mic-processor')
    this.worklet = worklet
    source.connect(worklet)
    const mute = micCtx.createGain()
    mute.gain.value = 0
    worklet.connect(mute).connect(micCtx.destination)

    const playCtx = new AudioContext({ sampleRate: PLAYBACK_RATE })
    this.playCtx = playCtx
    this.gain = playCtx.createGain()
    this.analyser = playCtx.createAnalyser()
    this.analyser.fftSize = 512
    this.gain.connect(this.analyser)
    this.analyser.connect(playCtx.destination)

    await this.openSocket()

    worklet.port.onmessage = (ev: MessageEvent<Int16Array>) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(ev.data.buffer)
    }

    this.startLevelLoop()
    this.handlers.onStatus('live')
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      ws.onopen = () => {
        this.send({ type: 'session.start', channel: 'web' })
        resolve()
      }
      ws.onerror = () => {
        this.handlers.onStatus('error')
        reject(new Error('voice server unreachable'))
      }
      ws.onclose = () => this.handlers.onStatus('ended')
      ws.onmessage = (ev) => this.onMessage(ev)
    })
  }

  private onMessage(ev: MessageEvent): void {
    if (ev.data instanceof ArrayBuffer) {
      this.enqueue(new Int16Array(ev.data))
      return
    }
    let event: ServerEvent
    try {
      event = JSON.parse(String(ev.data)) as ServerEvent
    } catch {
      return
    }
    // Live decided the caller cut in. Drop everything still queued.
    if (event.type === 'tts.cancel') this.duck()
    this.handlers.onEvent(event)
  }

  private enqueue(pcm: Int16Array): void {
    const ctx = this.playCtx
    if (!ctx || !this.gain || pcm.length === 0) return

    if (this.gain.gain.value < 1) {
      this.gain.gain.cancelScheduledValues(ctx.currentTime)
      this.gain.gain.setValueAtTime(1, ctx.currentTime)
    }

    const buffer = ctx.createBuffer(1, pcm.length, PLAYBACK_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768

    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(this.gain)

    // Back-to-back on the audio clock. Firing each chunk on arrival leaves
    // audible seams; resetting the cursor per utterance overlaps them.
    const startAt = Math.max(this.nextStartAt, ctx.currentTime + 0.04)
    node.start(startAt)
    this.nextStartAt = startAt + buffer.duration
    this.scheduled.push(node)
    node.onended = () => {
      this.scheduled = this.scheduled.filter((n) => n !== node)
    }
  }

  /** Stop talking without the click that reads as a dropped call. */
  private duck(): void {
    const ctx = this.playCtx
    if (!ctx || !this.gain) return
    const now = ctx.currentTime
    const g = this.gain.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + DUCK_RAMP_MS / 1000)

    window.setTimeout(() => {
      for (const n of this.scheduled) {
        try {
          n.stop()
        } catch {
          /* already ended */
        }
      }
      this.scheduled = []
      this.nextStartAt = 0
    }, DUCK_RAMP_MS)
  }

  private startLevelLoop(): void {
    const micData = new Uint8Array(this.micAnalyser?.frequencyBinCount ?? 0)
    const agentData = new Uint8Array(this.analyser?.frequencyBinCount ?? 0)
    const tick = () => {
      let mic = 0
      let agent = 0
      if (this.micAnalyser) {
        this.micAnalyser.getByteFrequencyData(micData)
        mic = avg(micData) / 255
      }
      if (this.analyser) {
        this.analyser.getByteFrequencyData(agentData)
        agent = avg(agentData) / 255
      }
      this.handlers.onLevel(mic, agent)
      this.levelFrame = requestAnimationFrame(tick)
    }
    this.levelFrame = requestAnimationFrame(tick)
  }

  spectrum(target: 'mic' | 'agent'): Uint8Array {
    const node = target === 'mic' ? this.micAnalyser : this.analyser
    if (!node) return new Uint8Array(0)
    const data = new Uint8Array(node.frequencyBinCount)
    node.getByteFrequencyData(data)
    return data
  }

  private send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }

  /** Kept for API compatibility; Live detects interruption from audio itself. */
  interrupt(): void {
    this.duck()
    this.send({ type: 'control.interrupt' })
  }

  async disconnect(): Promise<void> {
    this.send({ type: 'session.end' })

    // Silence first, synchronously. Closing sockets and AudioContexts both
    // return promises, and if either is slow the caller keeps hearing the agent
    // after pressing End — "end call" has to mean silence now, not eventually.
    this.stopAudioNow()
    await this.teardown()
    this.handlers.onStatus('ended')
  }

  private stopAudioNow(): void {
    for (const n of this.scheduled) {
      try { n.stop() } catch { /* already ended */ }
    }
    this.scheduled = []
    this.nextStartAt = 0
    if (this.gain) this.gain.gain.value = 0
  }
}

function avg(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] ?? 0
  return sum / data.length
}
