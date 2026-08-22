import { Modality, Type, type LiveConnectConfig, type FunctionDeclaration } from '@google/genai'
import { accentFor, type Lang } from '@vaani/shared'
import { TOOL_DEFS, pronunciationGuide, speechVocabulary } from '@vaani/agent'

/**
 * The Vaani session, as one config object.
 *
 * This replaces the entire cascaded pipeline: STT, TTS, turn-taking,
 * endpointing, barge-in truncation and sentence chunking are all native to the
 * Live API. Roughly 2,200 lines of hand-built machinery became these forty.
 *
 * The approach — and several of the hard-won details — follow the real-estate
 * agent in this author's other repo, which solved the same problems first.
 */

export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview'
export const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE ?? 'Leda'

/** Live speaks at 24 kHz and listens at 16 kHz. Confirmed against the API. */
export const LIVE_OUTPUT_RATE = 24_000
export const LIVE_INPUT_RATE = 16_000

/** Our JSON-Schema tool definitions, in the shape Gemini expects. */
function toFunctionDeclarations(): FunctionDeclaration[] {
  return TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiSchema(t.parameters as Record<string, unknown>),
  }))
}

function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const TYPES: Record<string, Type> = {
    object: Type.OBJECT,
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
    array: Type.ARRAY,
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = TYPES[v] ?? Type.STRING
    else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, Record<string, unknown>>).map(([pk, pv]) => [
          pk,
          toGeminiSchema(pv),
        ]),
      )
    } else out[k] = v
  }
  return out
}

export interface LiveConfigOptions {
  systemInstruction: string
  /**
   * Sets `speechConfig.languageCode`, which is what carries the accent.
   * Measured: Hindi intelligibility 90% → 93% with hi-IN pinned. It can only be
   * set at connect, so following the caller means reconnecting.
   */
  lang: Lang
  voice?: string
  resumeHandle?: string
  /** Telephony has no browser echo cancellation and an 8 kHz codec. */
  channel?: 'browser' | 'phone'
}

export function buildLiveConfig(opts: LiveConfigOptions): LiveConnectConfig {
  const { systemInstruction, lang, voice = LIVE_VOICE, resumeHandle, channel = 'browser' } = opts

  /**
   * Transcription language is left to auto-detection — measured, and it
   * contradicts the reference implementation this design otherwise follows.
   *
   * Pinning `languageCodes` was supposed to stop the recogniser drifting. On
   * gemini-3.1-flash-live-preview it does the opposite: **any config that lists
   * hi-IN renders English speech in Devanagari**, whatever the order.
   * "Hello, I would like to book a teeth cleaning appointment" came back as
   * "हेलो, आई वुड लाइक टू बुक अ टीथ क्लीनिंग अपॉइंटमेंट" — the words right, the
   * script wrong. On screen that reads as a broken transcript, and it fools any
   * language detector reading the text into a switch the caller never made.
   *
   * Measured across all three registers:
   *   English   auto → Latin ✓      pinned → Devanagari ✗
   *   Hindi     auto → Devanagari ✓ pinned → Devanagari ✓
   *   Hinglish  auto → Devanagari ✓ pinned → Devanagari ✓
   *
   * Auto-detect is never worse and is decisively better on English, so the pin
   * is gone. `languageCode` is not populated on this model either, so nothing
   * downstream may depend on it.
   */
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: `${systemInstruction}\n\n${pronunciationGuide()}`,
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      /**
       * The accent.
       *
       * Same voice throughout, pinned to the language actually being spoken
       * rather than reading Tamil with an English mouth. Hinglish takes the
       * Hindi accent because that is what Hinglish is — Hindi speech that
       * borrows English words.
       */
      languageCode: accentFor(lang),
    },

    inputAudioTranscription: {
      // Doctor surnames, treatments and Indian place names are exactly what a
      // general recogniser mangles, and exactly what must be right to look a
      // patient up.
      customVocabulary: speechVocabulary(),
    },
    outputAudioTranscription: {},

    tools: [{ functionDeclarations: toFunctionDeclarations() }],

    realtimeInputConfig: {
      automaticActivityDetection: {
        // How long a pause runs before the caller's turn is treated as over.
        // Long enough to survive a breath or a moment's thought about a date,
        // short enough that the reply feels immediate. A phone line adds codec
        // and network gaps on top of the human ones.
        silenceDurationMs: channel === 'phone' ? 800 : 650,
        // How much sustained sound opens a turn. Low, so the first syllable is
        // heard rather than spent proving someone is talking.
        prefixPaddingMs: 200,
      },
    },

    // Without this a long call eventually hits the context ceiling and the
    // server drops the session mid-conversation.
    contextWindowCompression: { slidingWindow: {} },

    // Returns a handle to reconnect with after a network blip.
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},

    temperature: 0.85,
  }
}
