import 'dotenv/config'
import { join } from 'node:path'
import { CachedTts, PHRASES, PHRASE_KEYS, elevenLabsTts, sarvamTts } from '@vaani/providers'
import { ALL_LANGS } from '@vaani/shared'

/**
 * Pre-render every stock phrase, once, at build time.
 *
 * Most of what a receptionist says on any given call is identical every time.
 * Synthesising it per call pays an API bill and a latency cost for audio that
 * never changes; rendering it once means those utterances play back from disk
 * in under 30 ms, free, in the premium voice.
 */
const DIR = join(process.cwd(), 'apps/voice-server/cache/phrases')
const useEleven = (process.env.ELEVENLABS_API_KEY ?? '') !== ''
const inner = useEleven ? elevenLabsTts : sarvamTts
const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'sarvam-anushka'

const tts = new CachedTts(inner, DIR)

let done = 0
const total = PHRASE_KEYS.length * ALL_LANGS.length
console.log(`warming ${total} phrases via ${inner.id} → ${DIR}\n`)

for (const key of PHRASE_KEYS) {
  for (const lang of ALL_LANGS) {
    const text = PHRASES[key][lang]
    try {
      await tts.warm(text, { voiceId, lang, modelId: inner.id })
      console.log(`  ✓ ${String(++done).padStart(2)}/${total}  ${key} · ${lang}`)
    } catch (err) {
      console.warn(`  ✗ ${key} · ${lang}: ${err instanceof Error ? err.message : err}`)
    }
  }
}
console.log('\ncache warm.')
