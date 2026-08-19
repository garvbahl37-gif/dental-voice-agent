import { ProviderRegistry } from './registry'
import { ollamaLlm, piperTts, whisperCppStt } from './local'
import { deepgramStt, elevenLabsTts, geminiLlm } from './cloud'
import { groqLlm, groqStt } from './groq'
import { CachedTts } from './phrase-cache'
import { FailoverLlm } from './failover'

/**
 * The production registry.
 *
 * Within each pool the FIRST provider matching the requested tier wins, so
 * order encodes preference. Cloud STT and LLM lead with Groq because
 * time-to-first-token dominates how human the agent feels, and Groq's is the
 * lowest available; Sarvam follows as the strongest Indic-specific option.
 *
 * Both TTS providers are wrapped in the phrase cache, so cached playback works
 * on either tier.
 */
export function buildRegistry(cacheDir: string): ProviderRegistry {
  return new ProviderRegistry({
    stt: [whisperCppStt, groqStt, deepgramStt],
    // Groq first for time-to-first-token; Gemini catches its rate limits,
    // which on a shared tier are a routine mid-call event rather than an outage.
    llm: [ollamaLlm, new FailoverLlm([groqLlm, geminiLlm])],
    tts: [new CachedTts(piperTts, cacheDir), new CachedTts(elevenLabsTts, cacheDir)],
  })
}
