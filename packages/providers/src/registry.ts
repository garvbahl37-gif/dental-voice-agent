import type {
  LlmProvider,
  ResolvedProviders,
  SttProvider,
  Tier,
  TierConfig,
  TtsProvider,
} from './types'

/**
 * ProviderRegistry — resolves a requested tier into concrete providers.
 *
 * The governing rule is **downgrade, never throw**. A missing ELEVENLABS_API_KEY
 * is a completely ordinary state: the demo still runs, on Piper, and the console
 * says so. A voice agent that refuses to boot because one of five optional keys
 * is absent is a worse product than one that degrades and tells you.
 *
 * The only genuine error is a component with no local provider registered at
 * all — that is a packaging bug, caught in CI, not a runtime condition.
 */

type AnyProvider = { id: string; tier: Tier; isAvailable(): Promise<boolean> }

export interface RegistryProviders {
  stt: SttProvider[]
  llm: LlmProvider[]
  tts: TtsProvider[]
}

export interface ProviderDescription {
  id: string
  tier: Tier
  available: boolean
}

export class ProviderRegistry {
  /**
   * Availability is probed once per provider and cached. Probes can touch the
   * network or the filesystem, and re-running them on every call would add
   * latency to the one path that cannot afford it.
   */
  private readonly probeCache = new Map<string, Promise<boolean>>()

  constructor(private readonly providers: RegistryProviders) {}

  private probe(p: AnyProvider): Promise<boolean> {
    const cached = this.probeCache.get(p.id)
    if (cached) return cached
    const probe = p.isAvailable().catch(() => false)
    this.probeCache.set(p.id, probe)
    return probe
  }

  private async pick<T extends AnyProvider>(
    pool: T[],
    want: Tier,
    kind: 'stt' | 'llm' | 'tts',
  ): Promise<{ chosen: T; downgraded: boolean }> {
    const preferred = pool.find((p) => p.tier === want)
    if (preferred && (await this.probe(preferred))) {
      return { chosen: preferred, downgraded: false }
    }

    const local = pool.find((p) => p.tier === 'local')
    if (!local) {
      throw new Error(
        `no local ${kind} provider registered — every component needs a zero-key fallback`,
      )
    }
    return { chosen: local, downgraded: want !== 'local' }
  }

  async resolve(cfg: TierConfig): Promise<ResolvedProviders> {
    const [stt, llm, tts] = await Promise.all([
      this.pick(this.providers.stt, cfg.stt, 'stt'),
      this.pick(this.providers.llm, cfg.llm, 'llm'),
      this.pick(this.providers.tts, cfg.tts, 'tts'),
    ])

    const downgraded: ('stt' | 'llm' | 'tts')[] = []
    if (stt.downgraded) downgraded.push('stt')
    if (llm.downgraded) downgraded.push('llm')
    if (tts.downgraded) downgraded.push('tts')

    return { stt: stt.chosen, llm: llm.chosen, tts: tts.chosen, downgraded }
  }

  /** Availability of every registered provider, for the console tier switch. */
  async describe(): Promise<Record<'stt' | 'llm' | 'tts', ProviderDescription[]>> {
    const map = async (pool: AnyProvider[]): Promise<ProviderDescription[]> =>
      Promise.all(
        pool.map(async (p) => ({ id: p.id, tier: p.tier, available: await this.probe(p) })),
      )

    const [stt, llm, tts] = await Promise.all([
      map(this.providers.stt),
      map(this.providers.llm),
      map(this.providers.tts),
    ])
    return { stt, llm, tts }
  }

  /** Force re-probing — used after the user edits keys in the Agent Studio. */
  invalidate(): void {
    this.probeCache.clear()
  }
}

/** Read the default tier from the environment, defaulting to fully local. */
export function tierFromEnv(env: Record<string, string | undefined> = process.env): TierConfig {
  const one = (v: string | undefined): Tier => (v === 'cloud' ? 'cloud' : 'local')
  return { stt: one(env.TIER_STT), llm: one(env.TIER_LLM), tts: one(env.TIER_TTS) }
}
