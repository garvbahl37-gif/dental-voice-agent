import type { LlmDelta, LlmOptions, LlmProvider, Message, ToolDef } from './types'

/**
 * Failover across LLM providers.
 *
 * Rate limits are the normal failure mode on shared and free tiers, and they
 * arrive mid-sentence. Retrying in place only works when the provider asks for
 * a short wait; when Groq says "try again in 6.3 s", waiting is worse than the
 * failure — six seconds of dead air is an abandoned call.
 *
 * So the pipeline moves to the next provider instead. Order encodes preference:
 * the fastest first, the most permissive as the safety net.
 *
 * Failover only happens **before the first token**. Once speech has begun, the
 * caller has already heard the opening of a sentence, and starting a different
 * model's answer over the top of it would be worse than stopping cleanly.
 */
export class FailoverLlm implements LlmProvider {
  readonly id: string
  readonly tier: 'local' | 'cloud'

  constructor(private readonly providers: LlmProvider[]) {
    if (providers.length === 0) throw new Error('FailoverLlm needs at least one provider')
    this.id = providers.map((p) => p.id).join('→')
    this.tier = providers[0]!.tier
  }

  async isAvailable(): Promise<boolean> {
    const checks = await Promise.all(this.providers.map((p) => p.isAvailable().catch(() => false)))
    return checks.some(Boolean)
  }

  async *stream(
    messages: Message[],
    tools: ToolDef[],
    opts: LlmOptions = {},
  ): AsyncIterable<LlmDelta> {
    let lastError: unknown = null

    for (const provider of this.providers) {
      if (opts.signal?.aborted) return
      if (!(await provider.isAvailable().catch(() => false))) continue

      let produced = false
      try {
        for await (const delta of provider.stream(messages, tools, opts)) {
          produced = true
          yield delta
        }
        return
      } catch (err) {
        lastError = err
        // Past the first token this provider already owns the utterance;
        // handing over now would talk over what the caller is hearing.
        if (produced) throw err
        console.warn(
          `[llm] ${provider.id} failed before first token, trying next:`,
          err instanceof Error ? err.message.slice(0, 140) : err,
        )
      }
    }

    throw lastError ?? new Error('no LLM provider available')
  }
}
