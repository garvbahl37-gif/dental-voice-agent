import 'dotenv/config'
import WebSocket from 'ws'

/**
 * End-to-end smoke test against the running voice server.
 *
 * Real STT needs real speech, so caller turns are synthesised through Sarvam
 * TTS and fed back in as microphone audio. That exercises the genuine path —
 * audio in, transcription, model, tools, synthesis, audio out — rather than
 * asserting against a mock of it.
 *
 *   pnpm --filter @vaani/voice-server start     # in one shell
 *   pnpm tsx scripts/e2e-call.ts                # in another
 */

const URL = process.env.VOICE_SERVER_URL ?? 'ws://localhost:8787/session'
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY ?? ''
// A male voice, so the synthetic caller is never confused with the agent.
const CALLER_VOICE = 'bIHbv24MWmeRgasZH58o' // Will

const CALLER_TURNS = [
  { text: 'Hello, I would like to book a teeth cleaning appointment please.', lang: 'en-IN' },
  { text: 'My name is Rahul Verma and my number is nine eight seven six five four three two one zero.', lang: 'en-IN' },
]

async function synthesise(text: string, _langCode: string): Promise<Int16Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${CALLER_VOICE}?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    },
  )
  if (!res.ok) throw new Error(`caller synthesis failed: ${res.status} ${await res.text()}`)
  const raw = Buffer.from(await res.arrayBuffer())
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  if (!ELEVEN_KEY) throw new Error('ELEVENLABS_API_KEY required to synthesise caller speech')

  console.log('· synthesising caller audio…')
  const audio = await Promise.all(CALLER_TURNS.map((t) => synthesise(t.text, t.lang)))
  console.log(`  ${audio.map((a) => `${(a.length / 16000).toFixed(1)}s`).join(', ')}\n`)

  const ws = new WebSocket(URL)
  const transcript: string[] = []
  const toolsCalled: string[] = []
  let agentAudioBytes = 0
  let ready = false

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      agentAudioBytes += data.length
      return
    }
    const e = JSON.parse(data.toString()) as Record<string, string & number & boolean>

    switch (e.type) {
      case 'session.ready':
        ready = true
        console.log(`· session ready — ${JSON.stringify(e.tier)}`)
        if (Array.isArray(e.downgraded) && e.downgraded.length) {
          console.log(`  downgraded: ${(e.downgraded as unknown as string[]).join(', ')}`)
        }
        break
      case 'stt.final':
        transcript.push(`CALLER  ${e.text}`)
        console.log(`\n  CALLER  ${e.text}   [${e.lang}${e.codeSwitched ? ', code-switched' : ''}]`)
        break
      case 'tts.begin':
        transcript.push(`PRIYA   ${e.text}`)
        console.log(`  PRIYA   ${e.text}   [${e.lang}]`)
        break
      case 'tool.call':
        toolsCalled.push(String(e.name))
        console.log(`     ⚙ ${e.name}(${JSON.stringify(e.args)})`)
        break
      case 'tool.result':
        console.log(`     ← ${e.name} ${e.ok ? 'ok' : 'FAILED'} in ${Math.round(Number(e.ms))}ms`)
        break
      case 'metrics.turn':
        console.log(
          `     ⏱ stt ${Math.round(Number(e.sttMs))}ms · llm ${Math.round(Number(e.llmTtftMs))}ms` +
            ` · tts ${Math.round(Number(e.ttsTtfbMs))}ms · e2e ${Math.round(Number(e.e2eMs))}ms`,
        )
        break
      case 'error':
        console.error(`     ✗ ${e.code}: ${e.message}`)
        break
    }
  })

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })

  ws.send(JSON.stringify({ type: 'session.start', channel: 'web' }))
  while (!ready) await sleep(100)

  // Let the greeting finish before talking over it.
  await sleep(3500)

  for (let i = 0; i < audio.length; i++) {
    const pcm = audio[i]!
    console.log(`\n· caller turn ${i + 1}`)
    ws.send(JSON.stringify({ type: 'vad.speech_start', t: Date.now() }))

    // Stream in 20 ms frames at real time, as a microphone would.
    const FRAME = 320
    for (let o = 0; o < pcm.length; o += FRAME) {
      const frame = pcm.subarray(o, Math.min(o + FRAME, pcm.length))
      ws.send(Buffer.from(frame.buffer, frame.byteOffset, frame.length * 2))
      await sleep(20)
    }

    ws.send(JSON.stringify({ type: 'vad.speech_end', t: Date.now() }))

    // Silence, so the server's endpointing timer can fire.
    const silence = new Int16Array(FRAME)
    for (let f = 0; f < 60; f++) {
      ws.send(Buffer.from(silence.buffer))
      await sleep(20)
    }

    await sleep(9000) // let the agent think, call tools, and reply
  }

  ws.send(JSON.stringify({ type: 'session.end' }))
  await sleep(500)
  ws.close()

  console.log('\n─────────────────────────────────────────')
  console.log(`transcript turns : ${transcript.length}`)
  console.log(`tools called     : ${toolsCalled.join(', ') || 'none'}`)
  console.log(`agent audio      : ${(agentAudioBytes / 32000).toFixed(1)}s`)

  const ok = transcript.length >= 3 && agentAudioBytes > 0
  console.log(ok ? '\n✓ end-to-end call succeeded' : '\n✗ end-to-end call incomplete')
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
