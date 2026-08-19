import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Lang, WordMark } from '@vaani/shared'
import type { TtsOptions, TtsProvider, TtsStream } from './types'

/**
 * Phrase cache — the premium voice, at zero marginal cost.
 *
 * In a real reception call, most of what gets said is the same every time:
 * the greeting, "one moment", "let me check that", the confirmation pattern,
 * the sign-off. Synthesising those on every call pays an API bill and a
 * latency cost for audio that never changes.
 *
 * So they are rendered once at build time through ElevenLabs and stored to
 * disk with their word marks. Playback is a file read — roughly 30 ms, and
 * free. Only genuinely dynamic speech (names, times, knowledge answers) reaches
 * a provider at runtime.
 *
 * This is what makes an ElevenLabs-quality demo affordable to run continuously:
 * the majority of utterances in a typical call are cached.
 */

export type PhraseKey =
  | 'greeting'
  | 'greetingReturning'
  | 'greetingAfterHours'
  | 'hold'
  | 'holdLong'
  | 'backchannel'
  | 'backchannelAlt'
  | 'askName'
  | 'askPhone'
  | 'askService'
  | 'askPreferredTime'
  | 'confirmIntro'
  | 'bookedConfirm'
  | 'notUnderstood'
  | 'repeatRequest'
  | 'noSlots'
  | 'offerWaitlist'
  | 'transferring'
  | 'closing'
  | 'closingWarm'
  | 'emergencyRed'
  | 'consentRecording'
  | 'thanks'
  | 'apologyDelay'
  | 'silenceNudge'
  | 'silenceCheckIn'
  | 'silenceHangUp'

/**
 * Every phrase in all three registers.
 *
 * Note these are not translations of one another — they are what a receptionist
 * in each register would actually say. A literal Hindi translation of an
 * English service script sounds like a form letter read aloud.
 */
export const PHRASES: Record<PhraseKey, Record<Lang, string>> = {
  greeting: {
    // Spec §2.1: a real receptionist does not say "thank you for calling, how
    // may I assist you today". She says who she is and stops.
    'en-IN': 'Hi, Smile Dental Care, Priya speaking. How can I help?',
    'hi-IN': 'नमस्ते, स्माइल डेंटल केयर, प्रिया बोल रही हूँ। बताइए?',
    'hi-Latn-IN': 'Hi, Smile Dental Care, Priya bol rahi hoon. Boliye?',
  },
  greetingReturning: {
    'en-IN': 'Hello again! Good to hear from you. What can I do for you?',
    'hi-IN': 'नमस्ते! आपसे फिर बात करके अच्छा लगा। बताइए, क्या कर सकती हूँ?',
    'hi-Latn-IN': 'Arre namaste! Phir se baat karke accha laga. Boliye, kya karna hai?',
  },
  greetingAfterHours: {
    'en-IN':
      'Thank you for calling. The clinic is closed right now, but I can book you an appointment or take a message.',
    'hi-IN': 'कॉल करने के लिए धन्यवाद। क्लिनिक अभी बंद है, लेकिन मैं अपॉइंटमेंट बुक कर सकती हूँ।',
    'hi-Latn-IN': 'Call karne ke liye shukriya. Clinic abhi band hai, par main appointment book kar sakti hoon.',
  },
  hold: {
    'en-IN': 'One second, let me check that for you.',
    'hi-IN': 'एक सेकंड, मैं देखती हूँ।',
    'hi-Latn-IN': 'Ek second, main dekhti hoon.',
  },
  holdLong: {
    'en-IN': 'Still looking, just a moment more.',
    'hi-IN': 'बस देख ही रही हूँ, एक मिनट।',
    'hi-Latn-IN': 'Bas dekh rahi hoon, ek minute.',
  },
  backchannel: {
    'en-IN': 'Mm-hmm.',
    'hi-IN': 'जी।',
    'hi-Latn-IN': 'Ji.',
  },
  backchannelAlt: {
    'en-IN': 'Right.',
    'hi-IN': 'अच्छा।',
    'hi-Latn-IN': 'Accha.',
  },
  askName: {
    'en-IN': 'May I have your name, please?',
    'hi-IN': 'आपका नाम बता दीजिए?',
    'hi-Latn-IN': 'Aapka naam bata dijiye?',
  },
  askPhone: {
    'en-IN': 'And a mobile number where we can reach you?',
    'hi-IN': 'और एक मोबाइल नंबर, जहाँ हम आपसे संपर्क कर सकें?',
    'hi-Latn-IN': 'Aur ek mobile number, jahan hum contact kar sakein?',
  },
  askService: {
    'en-IN': 'What would you like to come in for?',
    'hi-IN': 'आप किस चीज़ के लिए आना चाहते हैं?',
    'hi-Latn-IN': 'Aap kis cheez ke liye aana chahte hain?',
  },
  askPreferredTime: {
    'en-IN': 'Do you prefer a morning or an evening slot?',
    'hi-IN': 'आपको सुबह का समय ठीक रहेगा या शाम का?',
    'hi-Latn-IN': 'Aapko subah ka time theek rahega ya shaam ka?',
  },
  confirmIntro: {
    'en-IN': 'Let me just read that back to you.',
    'hi-IN': 'मैं एक बार दोहरा देती हूँ।',
    'hi-Latn-IN': 'Main ek baar repeat kar deti hoon.',
  },
  bookedConfirm: {
    'en-IN': "You're all booked. I'll send a confirmation on WhatsApp right away.",
    'hi-IN': 'आपकी अपॉइंटमेंट बुक हो गई है। मैं अभी व्हाट्सएप पर कन्फर्मेशन भेज देती हूँ।',
    'hi-Latn-IN': 'Aapki appointment book ho gayi hai. Main abhi WhatsApp par confirmation bhej deti hoon.',
  },
  notUnderstood: {
    'en-IN': "Sorry, I didn't quite catch that.",
    'hi-IN': 'माफ़ कीजिए, मैं ठीक से समझ नहीं पाई।',
    'hi-Latn-IN': 'Sorry, main theek se samajh nahi payi.',
  },
  repeatRequest: {
    'en-IN': 'Could you say that once more for me?',
    'hi-IN': 'एक बार फिर से बता दीजिए?',
    'hi-Latn-IN': 'Ek baar phir se bata dijiye?',
  },
  noSlots: {
    'en-IN': "I don't have anything open at that time.",
    'hi-IN': 'उस समय कोई स्लॉट खाली नहीं है।',
    'hi-Latn-IN': 'Us time koi slot khaali nahi hai.',
  },
  offerWaitlist: {
    'en-IN': "I can put you on the waitlist and call you the moment something opens up.",
    'hi-IN': 'मैं आपको वेटलिस्ट पर रख देती हूँ और स्लॉट खाली होते ही कॉल कर दूँगी।',
    'hi-Latn-IN': 'Main aapko waitlist par rakh deti hoon, slot khaali hote hi call kar doongi.',
  },
  transferring: {
    'en-IN': "Let me put you through to someone at the clinic. One moment.",
    'hi-IN': 'मैं आपको क्लिनिक में किसी से जोड़ती हूँ। एक मिनट।',
    'hi-Latn-IN': 'Main aapko clinic mein kisi se connect karti hoon. Ek minute.',
  },
  closing: {
    'en-IN': 'Thank you for calling. See you soon!',
    'hi-IN': 'कॉल करने के लिए धन्यवाद। जल्दी मिलते हैं!',
    'hi-Latn-IN': 'Call karne ke liye shukriya. Jaldi milte hain!',
  },
  closingWarm: {
    'en-IN': 'Take care, and see you on the day.',
    'hi-IN': 'अपना ध्यान रखिए, उस दिन मिलते हैं।',
    'hi-Latn-IN': 'Apna dhyaan rakhiye, us din milte hain.',
  },
  emergencyRed: {
    'en-IN':
      'This sounds like it needs urgent attention. Please go to the nearest emergency room now, and I will alert the clinic straight away.',
    'hi-IN':
      'यह गंभीर लग रहा है। कृपया अभी नज़दीकी इमरजेंसी में जाइए, मैं क्लिनिक को तुरंत सूचित कर रही हूँ।',
    'hi-Latn-IN':
      'Yeh serious lag raha hai. Please abhi nazdeeki emergency room jaiye, main clinic ko turant inform kar rahi hoon.',
  },
  consentRecording: {
    'en-IN': 'Just so you know, this call is recorded for quality and your records.',
    'hi-IN': 'आपको बता दूँ, यह कॉल क्वालिटी और रिकॉर्ड के लिए रिकॉर्ड की जा रही है।',
    'hi-Latn-IN': 'Aapko bata doon, yeh call quality ke liye record ho rahi hai.',
  },
  thanks: {
    'en-IN': 'Thank you.',
    'hi-IN': 'धन्यवाद।',
    'hi-Latn-IN': 'Shukriya.',
  },
  apologyDelay: {
    'en-IN': 'Sorry to keep you waiting.',
    'hi-IN': 'इंतज़ार कराने के लिए माफ़ी।',
    'hi-Latn-IN': 'Intezaar karane ke liye sorry.',
  },
  silenceNudge: {
    'en-IN': 'Hello?',
    'hi-IN': 'हैलो?',
    'hi-Latn-IN': 'Hello?',
  },
  silenceCheckIn: {
    'en-IN': 'Are you still there?',
    'hi-IN': 'आप लाइन पर हैं?',
    'hi-Latn-IN': 'Aap line par hain?',
  },
  silenceHangUp: {
    'en-IN': "It sounds like we may have lost the connection. Do call us back any time.",
    'hi-IN': 'लगता है कॉल कट गई है। आप कभी भी दोबारा कॉल कर सकते हैं।',
    'hi-Latn-IN': 'Lagta hai call cut gayi hai. Aap kabhi bhi dobara call kar sakte hain.',
  },
}

export const PHRASE_KEYS = Object.keys(PHRASES) as PhraseKey[]

/** Total renders needed to warm the cache in every language. */
export const PHRASE_COUNT = PHRASE_KEYS.length * 3

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * Cache identity. Model id is part of the key so a model change invalidates
 * every entry — stale audio from a superseded voice model is worse than a miss,
 * because it silently ships a different-sounding agent.
 */
export function cacheKey(text: string, voiceId: string, lang: Lang, modelId: string): string {
  return createHash('sha256')
    .update(`${modelId} ${voiceId} ${lang} ${text}`)
    .digest('hex')
    .slice(0, 16)
}

interface CacheEntry {
  pcm: Int16Array
  marks: WordMark[]
}

/**
 * Wraps any `TtsProvider`. Works identically over ElevenLabs and Piper, so the
 * cache is a property of the pipeline rather than of one vendor.
 */
export class CachedTts implements TtsProvider {
  readonly id: string
  readonly tier: 'local' | 'cloud'
  private readonly mem = new Map<string, CacheEntry>()

  constructor(
    private readonly inner: TtsProvider,
    private readonly dir: string,
  ) {
    this.id = `cached(${inner.id})`
    this.tier = inner.tier
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable()
  }

  private path(key: string, ext: string): string {
    return join(this.dir, `${key}.${ext}`)
  }

  /** True when this exact utterance can be served from disk with no API call. */
  has(text: string, opts: TtsOptions): boolean {
    const key = cacheKey(text, opts.voiceId, opts.lang, opts.modelId ?? this.inner.id)
    return this.mem.has(key) || existsSync(this.path(key, 'pcm'))
  }

  private async load(key: string): Promise<CacheEntry | null> {
    const cached = this.mem.get(key)
    if (cached) return cached
    try {
      const [raw, marksJson] = await Promise.all([
        readFile(this.path(key, 'pcm')),
        readFile(this.path(key, 'marks.json'), 'utf8'),
      ])
      const entry: CacheEntry = {
        pcm: new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2)),
        marks: JSON.parse(marksJson) as WordMark[],
      }
      this.mem.set(key, entry)
      return entry
    } catch {
      return null
    }
  }

  synth(text: string, opts: TtsOptions): TtsStream {
    const key = cacheKey(text, opts.voiceId, opts.lang, opts.modelId ?? this.inner.id)
    const inner = this.inner
    let aborted = false
    let resolveMarks!: (m: WordMark[]) => void
    const marks = new Promise<WordMark[]>((r) => {
      resolveMarks = r
    })
    const self = this

    const audio: AsyncIterable<Int16Array> = {
      async *[Symbol.asyncIterator]() {
        const hit = await self.load(key)
        if (hit) {
          resolveMarks(hit.marks)
          // Chunked so the transport paces identically to a live stream —
          // a cache hit must not change downstream timing behaviour.
          const CHUNK = 1600 // 100 ms
          for (let i = 0; i < hit.pcm.length; i += CHUNK) {
            if (aborted) return
            yield hit.pcm.subarray(i, Math.min(i + CHUNK, hit.pcm.length))
          }
          return
        }

        const stream = inner.synth(text, opts)
        void stream.marks.then(resolveMarks).catch(() => resolveMarks([]))
        for await (const chunk of stream.audio) {
          if (aborted) {
            stream.abort()
            return
          }
          yield chunk
        }
      },
    }

    return { audio, marks, abort: () => (aborted = true) }
  }

  /** Render and persist a phrase. Used by the build-time cache warmer. */
  async warm(text: string, opts: TtsOptions): Promise<void> {
    const key = cacheKey(text, opts.voiceId, opts.lang, opts.modelId ?? this.inner.id)
    if (await this.load(key)) return

    await mkdir(this.dir, { recursive: true })
    const stream = this.inner.synth(text, opts)
    const chunks: Int16Array[] = []
    for await (const chunk of stream.audio) chunks.push(chunk)

    const total = chunks.reduce((n, c) => n + c.length, 0)
    const pcm = new Int16Array(total)
    let o = 0
    for (const c of chunks) {
      pcm.set(c, o)
      o += c.length
    }
    const marks = await stream.marks

    await Promise.all([
      writeFile(this.path(key, 'pcm'), Buffer.from(pcm.buffer, 0, pcm.length * 2)),
      writeFile(this.path(key, 'marks.json'), JSON.stringify(marks)),
    ])
    this.mem.set(key, { pcm, marks })
  }
}

/** Look up the canonical text for a phrase key in a language. */
export function phrase(key: PhraseKey, lang: Lang): string {
  return PHRASES[key][lang]
}
