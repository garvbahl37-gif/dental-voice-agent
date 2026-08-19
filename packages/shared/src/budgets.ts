/**
 * Latency budgets — asserted by tests, not aspirational comments.
 *
 * Mouth-to-ear is the number that decides whether a caller believes they are
 * talking to a person. Above roughly 1.2 s the pause reads as "computer".
 * Every stage below has a ceiling, and CI fails when one regresses.
 */
export const BUDGETS = {
  cloud: {
    /** Final transcript ready after the caller stops speaking. */
    sttFinalMs: 250,
    /** LLM time-to-first-token. */
    llmTtftMs: 350,
    /** TTS time-to-first-byte. */
    ttsTtfbMs: 150,
    /** Total: caller stops speaking → first agent audio sample. */
    e2eP50Ms: 700,
    e2eP95Ms: 1100,
  },
  local: {
    sttFinalMs: 500,
    llmTtftMs: 700,
    ttsTtfbMs: 250,
    e2eP50Ms: 1400,
    e2eP95Ms: 2200,
  },
  /** Independent of tier — these are properties of the turn-taking engine. */
  interaction: {
    /** Caller starts speaking → agent audio silenced. */
    bargeInMs: 120,
    /** Gain ramp on interrupt. Instant cuts click and sound like a dropped call. */
    duckRampMs: 60,
    /** Phrase-cache hit → first audio sample. */
    cachedPhraseMs: 30,
    /** Tool call exceeding this gets a spoken hold phrase to avoid dead air. */
    holdPhraseAfterMs: 400,
    /** Continuous caller speech beyond this earns a backchannel. */
    backchannelAfterMs: 4000,

    /**
     * Silence handling. A caller who stops talking has not necessarily gone —
     * they may be finding a diary or asking someone else. So the first nudge
     * waits, the second is gentler about it, and only then does the line close.
     * Saying "hello?" three times is worse than saying nothing.
     */
    nudgeAfterMs: 6000,
    checkInAfterMs: 14000,
    hangUpAfterMs: 30000,
  },
} as const

export type Tier = 'local' | 'cloud'

export interface TurnMetrics {
  turnId: string
  sttMs: number
  llmTtftMs: number
  ttsTtfbMs: number
  e2eMs: number
  tier: Tier
  /** True when the phrase cache served this utterance. */
  cached: boolean
}

/** Which budget ceilings apply, given the tier that actually served the turn. */
export function budgetFor(tier: Tier) {
  return BUDGETS[tier]
}

/** Per-stage pass/fail, for the console latency HUD and the CI regression suite. */
export function checkBudget(m: TurnMetrics): { stage: string; ms: number; limit: number; ok: boolean }[] {
  const b = budgetFor(m.tier)
  return [
    { stage: 'stt', ms: m.sttMs, limit: b.sttFinalMs, ok: m.sttMs <= b.sttFinalMs },
    { stage: 'llm', ms: m.llmTtftMs, limit: b.llmTtftMs, ok: m.llmTtftMs <= b.llmTtftMs },
    { stage: 'tts', ms: m.ttsTtfbMs, limit: b.ttsTtfbMs, ok: m.ttsTtfbMs <= b.ttsTtfbMs },
    { stage: 'e2e', ms: m.e2eMs, limit: b.e2eP50Ms, ok: m.e2eMs <= b.e2eP50Ms },
  ]
}
