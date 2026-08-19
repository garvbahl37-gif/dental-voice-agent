import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from './registry'
import type { SttProvider, LlmProvider, TtsProvider, Tier } from './types'

function stub<T>(id: string, tier: Tier, available: boolean): T {
  return { id, tier, isAvailable: async () => available } as unknown as T
}

function registry() {
  return new ProviderRegistry({
    stt: [
      stub<SttProvider>('whisper', 'local', true),
      stub<SttProvider>('deepgram', 'cloud', false),
    ],
    llm: [stub<LlmProvider>('ollama', 'local', true), stub<LlmProvider>('gemini', 'cloud', true)],
    tts: [stub<TtsProvider>('piper', 'local', true), stub<TtsProvider>('eleven', 'cloud', false)],
  })
}

describe('ProviderRegistry.resolve', () => {
  it('honours an available cloud request', async () => {
    const r = await registry().resolve({ stt: 'local', llm: 'cloud', tts: 'local' })
    expect(r.llm.id).toBe('gemini')
    expect(r.downgraded).toEqual([])
  })

  it('downgrades to local when the cloud provider is unavailable', async () => {
    const r = await registry().resolve({ stt: 'local', llm: 'local', tts: 'cloud' })
    expect(r.tts.id).toBe('piper')
    expect(r.downgraded).toEqual(['tts'])
  })

  it('never throws when every cloud provider is unavailable', async () => {
    const r = await registry().resolve({ stt: 'cloud', llm: 'cloud', tts: 'cloud' })
    expect(r.stt.id).toBe('whisper')
    expect(r.tts.id).toBe('piper')
    expect(r.llm.id).toBe('gemini')
    expect([...r.downgraded].sort()).toEqual(['stt', 'tts'])
  })

  it('resolves each component independently', async () => {
    const r = await registry().resolve({ stt: 'local', llm: 'cloud', tts: 'cloud' })
    expect([r.stt.id, r.llm.id, r.tts.id]).toEqual(['whisper', 'gemini', 'piper'])
  })

  it('throws only when no local provider exists at all — a packaging bug, not a runtime state', async () => {
    const broken = new ProviderRegistry({
      stt: [stub<SttProvider>('deepgram', 'cloud', false)],
      llm: [stub<LlmProvider>('ollama', 'local', true)],
      tts: [stub<TtsProvider>('piper', 'local', true)],
    })
    await expect(broken.resolve({ stt: 'cloud', llm: 'local', tts: 'local' })).rejects.toThrow(
      /no local stt provider/i,
    )
  })

  it('caches availability probes within a resolution', async () => {
    let probes = 0
    const counting = {
      id: 'eleven',
      tier: 'cloud' as const,
      isAvailable: async () => {
        probes++
        return true
      },
    } as unknown as TtsProvider
    const reg = new ProviderRegistry({
      stt: [stub<SttProvider>('whisper', 'local', true)],
      llm: [stub<LlmProvider>('ollama', 'local', true)],
      tts: [stub<TtsProvider>('piper', 'local', true), counting],
    })
    await reg.resolve({ stt: 'local', llm: 'local', tts: 'cloud' })
    await reg.resolve({ stt: 'local', llm: 'local', tts: 'cloud' })
    expect(probes).toBe(1)
  })
})

describe('ProviderRegistry.describe', () => {
  it('reports what is available for the console tier switch', async () => {
    const d = await registry().describe()
    expect(d.tts).toEqual([
      { id: 'piper', tier: 'local', available: true },
      { id: 'eleven', tier: 'cloud', available: false },
    ])
  })
})
