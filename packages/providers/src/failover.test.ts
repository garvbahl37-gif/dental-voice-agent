import { describe, it, expect, vi } from 'vitest'
import { FailoverLlm } from './failover'
import type { LlmDelta, LlmProvider } from './types'

function provider(
  id: string,
  behaviour: 'ok' | 'throws' | 'throws-midway' | 'unavailable',
  text = 'hello there',
): LlmProvider {
  return {
    id,
    tier: 'cloud',
    isAvailable: async () => behaviour !== 'unavailable',
    async *stream(): AsyncIterable<LlmDelta> {
      if (behaviour === 'throws') throw new Error(`${id} 429`)
      yield { kind: 'text', text }
      if (behaviour === 'throws-midway') throw new Error(`${id} died midway`)
      yield { kind: 'done', finishReason: 'stop' }
    },
  }
}

async function collect(p: LlmProvider): Promise<string> {
  let out = ''
  for await (const d of p.stream([], [])) if (d.kind === 'text') out += d.text
  return out
}

describe('FailoverLlm', () => {
  it('uses the first provider when it works', async () => {
    const f = new FailoverLlm([provider('a', 'ok', 'from a'), provider('b', 'ok', 'from b')])
    expect(await collect(f)).toBe('from a')
  })

  it('falls through when the first is rate limited', async () => {
    const f = new FailoverLlm([provider('a', 'throws'), provider('b', 'ok', 'from b')])
    expect(await collect(f)).toBe('from b')
  })

  it('skips a provider with no key rather than failing', async () => {
    const f = new FailoverLlm([provider('a', 'unavailable'), provider('b', 'ok', 'from b')])
    expect(await collect(f)).toBe('from b')
  })

  it('does not switch providers once speech has started', async () => {
    // The caller is already hearing this sentence; a second model starting its
    // own answer over the top is worse than stopping.
    const b = provider('b', 'ok', 'from b')
    const spy = vi.spyOn(b, 'stream')
    const f = new FailoverLlm([provider('a', 'throws-midway', 'from a'), b])
    await expect(collect(f)).rejects.toThrow(/died midway/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('throws the last error when every provider fails', async () => {
    const f = new FailoverLlm([provider('a', 'throws'), provider('b', 'throws')])
    await expect(collect(f)).rejects.toThrow(/b 429/)
  })

  it('is available when any single provider is', async () => {
    const f = new FailoverLlm([provider('a', 'unavailable'), provider('b', 'ok')])
    expect(await f.isAvailable()).toBe(true)
  })

  it('is unavailable when none are', async () => {
    const f = new FailoverLlm([provider('a', 'unavailable'), provider('b', 'unavailable')])
    expect(await f.isAvailable()).toBe(false)
  })

  it('reports the chain it will try', () => {
    expect(new FailoverLlm([provider('groq', 'ok'), provider('gemini', 'ok')]).id).toBe(
      'groq→gemini',
    )
  })
})
