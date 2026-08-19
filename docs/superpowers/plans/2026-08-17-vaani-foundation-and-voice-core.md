# Vaani — Foundation & Voice Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo foundation and a working end-to-end voice loop — browser mic → STT → LLM → TTS → speaker — with sub-second latency, correct barge-in, and runtime-switchable local/cloud providers.

**Architecture:** One `Session` core owns all turn-taking and agent logic and talks to channels through a `Transport` interface, so Twilio and WhatsApp become adapters rather than rewrites. STT/LLM/TTS are resolved through a `ProviderRegistry` with a local tier (whisper.cpp, Ollama, Piper) and a cloud tier (Deepgram/Sarvam, Gemini, ElevenLabs), selectable per component at runtime. Barge-in truncates conversation history to the audio the caller actually heard, using TTS word-timing marks against reported playback position.

**Tech Stack:** TypeScript (strict), pnpm workspaces + Turborepo, Node 24, Next.js 16 App Router, Drizzle ORM + SQLite (`better-sqlite3`), `ws`, zod, Vitest, onnxruntime-web (Silero VAD), Web Audio API + AudioWorklet.

**Spec:** `docs/superpowers/specs/2026-08-17-vaani-voice-agent-design.md`

## Global Constraints

- **Node** ≥ 24. **pnpm** ≥ 9. Package manager is pnpm — never npm/yarn.
- **TypeScript strict mode** everywhere. `noUncheckedIndexedAccess: true`. No `any` in committed code; use `unknown` + zod narrowing.
- **ESM only.** `"type": "module"` in every package. Imports of local files carry no extension (bundler resolution); Node-run packages use `tsx`.
- **All cross-boundary payloads are zod-validated** at the boundary. The wire protocol is the contract.
- **Audio canonical format** inside the pipeline: PCM16, mono, 16 kHz, little-endian. Transports transcode at their edge. Never let a codec detail leak into `core`.
- **No API key may be required to boot.** Every cloud provider has a local counterpart; missing keys downgrade the tier and log once, never throw at startup.
- **Latency budgets are asserted, not aspirational.** Per-stage budgets live in `packages/shared/src/budgets.ts` and are checked by tests.
- **Language codes** are BCP-47 restricted to `en-IN`, `hi-IN`, `hi-Latn-IN` (Hinglish). Never bare `hi` or `en`.
- **Never log PII.** Phone, DOB, and patient names pass through `redact()` before any log call.
- Commit after every task. Conventional Commits (`feat:`, `test:`, `chore:`).

---

## File Structure

### `packages/shared` — the contract
| File | Responsibility |
|---|---|
| `src/protocol.ts` | zod schemas + TS types for every client↔server event |
| `src/audio.ts` | `AudioFormat`, frame-size maths, PCM16 helpers |
| `src/lang.ts` | `Lang` union, detection result types, normalisation types |
| `src/budgets.ts` | Per-stage latency budgets, single source of truth |
| `src/redact.ts` | PII redaction for logs |

### `packages/core` — turn-taking engine (no I/O, fully unit-testable)
| File | Responsibility |
|---|---|
| `src/transport.ts` | `Transport` interface — the channel abstraction |
| `src/endpointing.ts` | Adaptive silence-threshold decision function (pure) |
| `src/truncation.ts` | Map playback position → spoken word prefix (pure) |
| `src/turn-manager.ts` | Turn state machine, VAD fusion, barge-in orchestration |
| `src/session.ts` | Wires transport + pipeline + agent; owns conversation history |
| `src/resample.ts` | PCM resampling (8k↔16k) for telephony transports |

### `packages/providers` — swappable STT/LLM/TTS
| File | Responsibility |
|---|---|
| `src/types.ts` | `SttProvider`, `LlmProvider`, `TtsProvider` interfaces |
| `src/registry.ts` | Tier resolution, per-component override, availability probing |
| `src/stt/whisper-cpp.ts`, `src/stt/deepgram.ts` | STT adapters |
| `src/llm/ollama.ts`, `src/llm/gemini.ts` | LLM adapters |
| `src/tts/piper.ts`, `src/tts/elevenlabs.ts` | TTS adapters (emit word marks) |
| `src/tts/phrase-cache.ts` | Pre-rendered phrase lookup, wraps any `TtsProvider` |

### `packages/db` — data layer
| File | Responsibility |
|---|---|
| `src/schema.ts` | Drizzle schema, all tables |
| `src/client.ts` | Connection factory (SQLite local / Postgres prod) |
| `src/seed.ts` | Realistic practice seed data |

### `apps/voice-server` — the process
| File | Responsibility |
|---|---|
| `src/index.ts` | HTTP + WS server bootstrap |
| `src/ws-transport.ts` | `Transport` impl for browser WebSocket |
| `src/session-registry.ts` | Active session lifecycle |

---

## Task 1: Monorepo scaffold + shared protocol

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/protocol.ts`, `src/audio.ts`, `src/lang.ts`, `src/budgets.ts`, `src/redact.ts`
- Test: `packages/shared/src/protocol.test.ts`, `src/redact.test.ts`

**Interfaces:**
- Produces: `ClientEvent`, `ServerEvent` (discriminated unions), `parseClientEvent(raw: unknown): ClientEvent`, `Lang = 'en-IN' | 'hi-IN' | 'hi-Latn-IN'`, `WordMark { word: string; startMs: number; endMs: number }`, `BUDGETS`, `redact(s: string): string`

- [ ] **Step 1: Init workspace root**

```bash
cd /Users/garvbahl/Documents/Projects/DentalVoiceAgent
git init
pnpm init
```

Then set root `package.json`:
```json
{
  "name": "vaani",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.9",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.10.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Write the failing protocol test**

`packages/shared/src/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseClientEvent, type ServerEvent } from './protocol'

describe('parseClientEvent', () => {
  it('accepts a well-formed session.start', () => {
    const ev = parseClientEvent({ type: 'session.start', channel: 'web', tier: 'cloud' })
    expect(ev.type).toBe('session.start')
  })

  it('rejects an unknown event type', () => {
    expect(() => parseClientEvent({ type: 'nope' })).toThrow()
  })

  it('rejects playback.progress with a negative position', () => {
    expect(() =>
      parseClientEvent({ type: 'playback.progress', utteranceId: 'u1', playedMs: -5 }),
    ).toThrow()
  })

  it('accepts playback.progress at zero', () => {
    const ev = parseClientEvent({ type: 'playback.progress', utteranceId: 'u1', playedMs: 0 })
    expect(ev).toMatchObject({ type: 'playback.progress', playedMs: 0 })
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @vaani/shared test`
Expected: FAIL — cannot resolve `./protocol`.

- [ ] **Step 4: Implement the protocol**

`packages/shared/src/protocol.ts` — define `LangSchema`, then each client event as a zod object, combine with `z.discriminatedUnion('type', [...])`, and export:
```ts
export const ClientEventSchema = z.discriminatedUnion('type', [
  SessionStartSchema, VadSpeechStartSchema, VadSpeechEndSchema,
  PlaybackProgressSchema, ControlInterruptSchema, ControlDtmfSchema, SessionEndSchema,
])
export type ClientEvent = z.infer<typeof ClientEventSchema>
export function parseClientEvent(raw: unknown): ClientEvent {
  return ClientEventSchema.parse(raw)
}
```
`playedMs` uses `z.number().int().nonnegative()`. Mirror the same shape for `ServerEventSchema` covering every server event in spec §2.3.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @vaani/shared test`
Expected: PASS, 4 tests.

- [ ] **Step 6: Implement redaction + its test**

`packages/shared/src/redact.ts`:
```ts
const PHONE = /(\+?\d[\d\s-]{8,}\d)/g
const DOB = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g

export function redact(input: string): string {
  return input.replace(PHONE, '[phone]').replace(DOB, '[dob]')
}
```

`packages/shared/src/redact.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { redact } from './redact'

describe('redact', () => {
  it('masks Indian mobile numbers', () => {
    expect(redact('call me on +91 98765 43210')).toBe('call me on [phone]')
  })
  it('masks dates of birth', () => {
    expect(redact('dob 14/03/1991')).toBe('dob [dob]')
  })
  it('leaves ordinary text alone', () => {
    expect(redact('root canal on Thursday')).toBe('root canal on Thursday')
  })
})
```

Run: `pnpm --filter @vaani/shared test` → PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: monorepo scaffold and wire protocol contract"
```

---

## Task 2: Adaptive endpointing (pure function, no I/O)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/endpointing.ts`
- Test: `packages/core/src/endpointing.test.ts`

**Interfaces:**
- Consumes: `Lang` from `@vaani/shared`
- Produces:
```ts
export type QuestionKind = 'open' | 'yesno' | 'none'
export interface EndpointContext {
  questionKind: QuestionKind
  partialText: string
  lang: Lang
}
export function silenceThresholdMs(ctx: EndpointContext): number
```

- [ ] **Step 1: Write the failing tests**

`packages/core/src/endpointing.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { silenceThresholdMs } from './endpointing'

const base = { questionKind: 'none' as const, partialText: 'book an appointment', lang: 'en-IN' as const }

describe('silenceThresholdMs', () => {
  it('returns the base threshold with no modifiers', () => {
    expect(silenceThresholdMs(base)).toBe(600)
  })

  it('waits longer after an open question', () => {
    expect(silenceThresholdMs({ ...base, questionKind: 'open' })).toBe(900)
  })

  it('cuts in faster after a yes/no question', () => {
    expect(silenceThresholdMs({ ...base, questionKind: 'yesno' })).toBe(450)
  })

  it('waits longer when the caller trails off on an English filler', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'i want to um' })).toBe(1000)
  })

  it('waits longer on a Hindi filler', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'mujhe matlab', lang: 'hi-Latn-IN' })).toBe(1000)
  })

  it('waits longer when the utterance is grammatically incomplete', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'my name is' })).toBe(1100)
  })

  it('waits longer mid phone number', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'my number is 98765' })).toBe(1100)
  })

  it('does not wait extra on a complete phone number', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'my number is 9876543210' })).toBe(600)
  })

  it('stacks question kind and filler modifiers', () => {
    expect(silenceThresholdMs({ ...base, questionKind: 'yesno', partialText: 'well uh' })).toBe(850)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/core test`
Expected: FAIL — `silenceThresholdMs` is not defined.

- [ ] **Step 3: Implement**

`packages/core/src/endpointing.ts`:
```ts
import type { Lang } from '@vaani/shared'

const BASE_MS = 600
const OPEN_QUESTION_MS = 300
const YESNO_QUESTION_MS = -150
const FILLER_MS = 400
const INCOMPLETE_MS = 500

const FILLERS = ['um', 'uh', 'er', 'hmm', 'matlab', 'toh', 'woh', 'yaani', 'ki']
const DANGLING = [
  /\b(is|are|was|were|my|your|the|a|an|and|or|but|to|for|at|on|of)$/i,
  /\b(mera|meri|hai|hain|ka|ke|ki|aur|ya|se|ko|par)$/i,
]

export type QuestionKind = 'open' | 'yesno' | 'none'

export interface EndpointContext {
  questionKind: QuestionKind
  partialText: string
  lang: Lang
}

function endsWithFiller(text: string): boolean {
  const last = text.trim().toLowerCase().split(/\s+/).at(-1) ?? ''
  return FILLERS.includes(last)
}

function isIncomplete(text: string): boolean {
  const t = text.trim()
  if (DANGLING.some((re) => re.test(t))) return true
  const digits = t.match(/\d+/g)?.at(-1) ?? ''
  // A partial run of digits reads as a phone number still being spoken.
  return digits.length > 0 && digits.length < 10 && /\d$/.test(t)
}

export function silenceThresholdMs(ctx: EndpointContext): number {
  let ms = BASE_MS
  if (ctx.questionKind === 'open') ms += OPEN_QUESTION_MS
  if (ctx.questionKind === 'yesno') ms += YESNO_QUESTION_MS
  if (endsWithFiller(ctx.partialText)) ms += FILLER_MS
  else if (isIncomplete(ctx.partialText)) ms += INCOMPLETE_MS
  return ms
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/core test`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: adaptive endpointing with filler and completeness detection"
```

---

## Task 3: Barge-in truncation maths

**Files:**
- Create: `packages/core/src/truncation.ts`
- Test: `packages/core/src/truncation.test.ts`

**Interfaces:**
- Consumes: `WordMark` from `@vaani/shared`
- Produces: `truncateToPlayed(marks: WordMark[], playedMs: number): { spoken: string; wasTruncated: boolean }`

**Why this matters:** without it the agent's history contains words the caller never heard, and every later turn reasons from a false record. This is the single highest-value correctness property in the voice core.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/truncation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { truncateToPlayed } from './truncation'
import type { WordMark } from '@vaani/shared'

const marks: WordMark[] = [
  { word: 'Doctor',    startMs: 0,    endMs: 400 },
  { word: 'Sharma',    startMs: 400,  endMs: 850 },
  { word: 'is',        startMs: 850,  endMs: 980 },
  { word: 'available', startMs: 980,  endMs: 1600 },
  { word: 'Thursday',  startMs: 1600, endMs: 2300 },
]

describe('truncateToPlayed', () => {
  it('keeps the whole utterance when playback completed', () => {
    expect(truncateToPlayed(marks, 2300)).toEqual({
      spoken: 'Doctor Sharma is available Thursday',
      wasTruncated: false,
    })
  })

  it('keeps only words that finished before the cut', () => {
    expect(truncateToPlayed(marks, 1000)).toEqual({
      spoken: 'Doctor Sharma is—',
      wasTruncated: true,
    })
  })

  it('drops a word cut mid-articulation', () => {
    // 1200ms lands inside "available" — the caller did not hear a usable word.
    expect(truncateToPlayed(marks, 1200)).toEqual({
      spoken: 'Doctor Sharma is—',
      wasTruncated: true,
    })
  })

  it('returns empty when interrupted before any word completed', () => {
    expect(truncateToPlayed(marks, 100)).toEqual({ spoken: '', wasTruncated: true })
  })

  it('handles an empty mark list', () => {
    expect(truncateToPlayed([], 500)).toEqual({ spoken: '', wasTruncated: true })
  })

  it('treats playback beyond the end as complete', () => {
    expect(truncateToPlayed(marks, 99_999)).toEqual({
      spoken: 'Doctor Sharma is available Thursday',
      wasTruncated: false,
    })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/core test -- truncation`
Expected: FAIL — `truncateToPlayed` is not defined.

- [ ] **Step 3: Implement**

`packages/core/src/truncation.ts`:
```ts
import type { WordMark } from '@vaani/shared'

export interface TruncationResult {
  spoken: string
  wasTruncated: boolean
}

/**
 * Given TTS word timings and how much audio actually reached the caller,
 * return only the words they heard in full. A word cut mid-articulation is
 * dropped — a half-spoken word is not information the caller received.
 */
export function truncateToPlayed(marks: WordMark[], playedMs: number): TruncationResult {
  const heard = marks.filter((m) => m.endMs <= playedMs)
  const complete = heard.length === marks.length && marks.length > 0
  if (complete) {
    return { spoken: marks.map((m) => m.word).join(' '), wasTruncated: false }
  }
  const spoken = heard.map((m) => m.word).join(' ')
  return { spoken: spoken.length > 0 ? `${spoken}—` : '', wasTruncated: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/core test -- truncation`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/truncation.ts packages/core/src/truncation.test.ts
git commit -m "feat: playback-accurate barge-in truncation"
```

---

## Task 4: Provider interfaces + registry with tier resolution

**Files:**
- Create: `packages/providers/package.json`, `tsconfig.json`, `src/types.ts`, `src/registry.ts`
- Test: `packages/providers/src/registry.test.ts`

**Interfaces:**
- Produces:
```ts
export type Tier = 'local' | 'cloud'
export interface TierConfig { stt: Tier; llm: Tier; tts: Tier }
export interface SttStream  { push(pcm: Int16Array): void; end(): Promise<void>;
                              on(ev: 'partial'|'final', cb: (r: SttResult) => void): void }
export interface SttProvider { readonly id: string; readonly tier: Tier;
                               isAvailable(): Promise<boolean>; stream(o: SttOptions): SttStream }
export interface LlmProvider { readonly id: string; readonly tier: Tier;
                               isAvailable(): Promise<boolean>;
                               stream(msgs: Message[], tools: ToolDef[]): AsyncIterable<LlmDelta> }
export interface TtsProvider { readonly id: string; readonly tier: Tier;
                               isAvailable(): Promise<boolean>;
                               synth(text: string, o: TtsOptions): TtsStream }
export class ProviderRegistry {
  constructor(providers: { stt: SttProvider[]; llm: LlmProvider[]; tts: TtsProvider[] })
  resolve(cfg: TierConfig): Promise<ResolvedProviders>
}
```

**Key behaviour:** `resolve` must *downgrade, never throw*. If cloud TTS is requested but `ELEVENLABS_API_KEY` is absent, it returns the local provider and records a `downgraded` note. Booting without keys is a hard requirement (Global Constraints).

- [ ] **Step 1: Write the failing tests**

`packages/providers/src/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from './registry'
import type { TtsProvider, SttProvider, LlmProvider } from './types'

const stub = <T extends { id: string; tier: 'local' | 'cloud' }>(
  id: string, tier: 'local' | 'cloud', available: boolean,
) => ({ id, tier, isAvailable: async () => available }) as unknown as T

const registry = () =>
  new ProviderRegistry({
    stt: [stub<SttProvider>('whisper', 'local', true), stub<SttProvider>('deepgram', 'cloud', false)],
    llm: [stub<LlmProvider>('ollama', 'local', true), stub<LlmProvider>('gemini', 'cloud', true)],
    tts: [stub<TtsProvider>('piper', 'local', true), stub<TtsProvider>('eleven', 'cloud', false)],
  })

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
    expect(r.downgraded.sort()).toEqual(['stt', 'tts'])
  })

  it('resolves each component independently', async () => {
    const r = await registry().resolve({ stt: 'local', llm: 'cloud', tts: 'cloud' })
    expect([r.stt.id, r.llm.id, r.tts.id]).toEqual(['whisper', 'gemini', 'piper'])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/providers test`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Implement `types.ts` then `registry.ts`**

`registry.ts` core logic:
```ts
export class ProviderRegistry {
  constructor(private readonly providers: {
    stt: SttProvider[]; llm: LlmProvider[]; tts: TtsProvider[]
  }) {}

  private async pick<T extends { id: string; tier: Tier; isAvailable(): Promise<boolean> }>(
    pool: T[], want: Tier,
  ): Promise<{ chosen: T; downgraded: boolean }> {
    const preferred = pool.find((p) => p.tier === want)
    if (preferred && (await preferred.isAvailable())) return { chosen: preferred, downgraded: false }
    const fallback = pool.find((p) => p.tier === 'local')
    if (!fallback) throw new Error('no local provider registered')
    return { chosen: fallback, downgraded: true }
  }

  async resolve(cfg: TierConfig): Promise<ResolvedProviders> {
    const [stt, llm, tts] = await Promise.all([
      this.pick(this.providers.stt, cfg.stt),
      this.pick(this.providers.llm, cfg.llm),
      this.pick(this.providers.tts, cfg.tts),
    ])
    const downgraded: string[] = []
    if (stt.downgraded) downgraded.push('stt')
    if (llm.downgraded) downgraded.push('llm')
    if (tts.downgraded) downgraded.push('tts')
    return { stt: stt.chosen, llm: llm.chosen, tts: tts.chosen, downgraded }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/providers test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/providers
git commit -m "feat: provider registry with graceful tier downgrade"
```

---

## Task 5: Database schema + realistic seed

**Files:**
- Create: `packages/db/package.json`, `tsconfig.json`, `drizzle.config.ts`, `src/schema.ts`, `src/client.ts`, `src/seed.ts`
- Test: `packages/db/src/seed.test.ts`

**Interfaces:**
- Produces: all Drizzle tables from spec §6, `getDb(url?: string)`, `seed(db): Promise<SeedSummary>`

- [ ] **Step 1: Write the failing seed test**

`packages/db/src/seed.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { getDb } from './client'
import { seed } from './seed'
import { providers, operatories, services, patients, appointments, kbChunks } from './schema'

let db: ReturnType<typeof getDb>

beforeAll(async () => {
  db = getDb(':memory:')
  await seed(db)
})

describe('seed', () => {
  it('creates three dentists', async () => {
    expect((await db.select().from(providers)).length).toBe(3)
  })
  it('creates four operatories', async () => {
    expect((await db.select().from(operatories)).length).toBe(4)
  })
  it('creates twelve services with non-zero durations', async () => {
    const rows = await db.select().from(services)
    expect(rows.length).toBe(12)
    expect(rows.every((s) => s.durationMin > 0)).toBe(true)
  })
  it('creates patients with a mix of language preferences', async () => {
    const rows = await db.select().from(patients)
    expect(rows.length).toBeGreaterThanOrEqual(40)
    expect(new Set(rows.map((p) => p.preferredLanguage)).size).toBeGreaterThan(1)
  })
  it('creates existing appointments so the calendar is never empty', async () => {
    expect((await db.select().from(appointments)).length).toBeGreaterThan(20)
  })
  it('populates the knowledge base', async () => {
    expect((await db.select().from(kbChunks)).length).toBeGreaterThan(30)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/db test`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement schema, client, and seed**

Schema covers spec §6 tables. `services` seed values (durations drive the slot solver):

| Service | Duration | Buffer |
|---|---|---|
| Consultation | 20 | 5 |
| Scaling & polishing | 30 | 10 |
| Composite filling | 45 | 10 |
| Root canal (single sitting) | 90 | 15 |
| Crown fitting | 60 | 10 |
| Tooth extraction | 45 | 15 |
| Wisdom tooth surgery | 90 | 20 |
| Teeth whitening | 60 | 10 |
| Braces consultation | 30 | 5 |
| Braces adjustment | 30 | 5 |
| Denture fitting | 60 | 10 |
| Emergency visit | 30 | 15 |

Patients seeded with Indian names and `preferredLanguage` spread across all three `Lang` values. Appointments seeded across the next 14 business days at ~60 % occupancy — dense enough to look real, sparse enough that booking succeeds live on stage.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/db test`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat: practice schema and realistic seed data"
```

---

## Task 6: TurnManager — VAD fusion, endpointing, barge-in orchestration

**Files:**
- Create: `packages/core/src/turn-manager.ts`, `packages/core/src/transport.ts`
- Test: `packages/core/src/turn-manager.test.ts`

**Interfaces:**
- Consumes: `silenceThresholdMs` (Task 2), `truncateToPlayed` (Task 3), `WordMark` (Task 1)
- Produces:
```ts
export type TurnState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'tool_running'
export interface TurnManagerEvents {
  stateChange(s: TurnState): void
  endpoint(): void                                   // caller finished — run the agent
  bargeIn(r: { utteranceId: string; truncateAtMs: number }): void
}
export class TurnManager {
  constructor(opts: { now: () => number; emit: TurnManagerEvents })
  onVadSpeechStart(t: number): void
  onVadSpeechEnd(t: number): void
  onPartial(text: string, lang: Lang): void
  onAgentSpeakStart(utteranceId: string, marks: WordMark[]): void
  onPlaybackProgress(utteranceId: string, playedMs: number): void
  tick(): void                                       // drives silence timers
  get state(): TurnState
}
```

An injected `now()` clock keeps every timing test deterministic — no `setTimeout`, no flake.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/turn-manager.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { TurnManager } from './turn-manager'

function harness() {
  let t = 0
  const events = { stateChange: vi.fn(), endpoint: vi.fn(), bargeIn: vi.fn() }
  const tm = new TurnManager({ now: () => t, emit: events })
  return { tm, events, advance: (ms: number) => { t += ms; tm.tick() } }
}

describe('TurnManager', () => {
  it('enters listening when the caller starts speaking', () => {
    const { tm, advance } = harness()
    tm.onVadSpeechStart(0)
    advance(0)
    expect(tm.state).toBe('listening')
  })

  it('does not endpoint before the silence threshold elapses', () => {
    const { tm, events, advance } = harness()
    tm.onVadSpeechStart(0)
    tm.onPartial('book an appointment', 'en-IN')
    tm.onVadSpeechEnd(500)
    advance(500)
    expect(events.endpoint).not.toHaveBeenCalled()
  })

  it('endpoints once the silence threshold elapses', () => {
    const { tm, events, advance } = harness()
    tm.onVadSpeechStart(0)
    tm.onPartial('book an appointment', 'en-IN')
    tm.onVadSpeechEnd(0)
    advance(650)
    expect(events.endpoint).toHaveBeenCalledOnce()
  })

  it('extends the wait when the caller trails off mid-sentence', () => {
    const { tm, events, advance } = harness()
    tm.onVadSpeechStart(0)
    tm.onPartial('my name is', 'en-IN')
    tm.onVadSpeechEnd(0)
    advance(650)
    expect(events.endpoint).not.toHaveBeenCalled()   // needs 1100ms
    advance(500)
    expect(events.endpoint).toHaveBeenCalledOnce()
  })

  it('cancels a pending endpoint when the caller resumes', () => {
    const { tm, events, advance } = harness()
    tm.onVadSpeechStart(0)
    tm.onPartial('i want', 'en-IN')
    tm.onVadSpeechEnd(0)
    advance(400)
    tm.onVadSpeechStart(400)     // resumed
    advance(400)
    expect(events.endpoint).not.toHaveBeenCalled()
  })

  it('fires barge-in when the caller speaks over the agent', () => {
    const { tm, events } = harness()
    tm.onAgentSpeakStart('u1', [{ word: 'Doctor', startMs: 0, endMs: 400 }])
    tm.onPlaybackProgress('u1', 380)
    tm.onVadSpeechStart(380)
    expect(events.bargeIn).toHaveBeenCalledWith({ utteranceId: 'u1', truncateAtMs: 380 })
  })

  it('does not fire barge-in when the agent is not speaking', () => {
    const { tm, events } = harness()
    tm.onVadSpeechStart(0)
    expect(events.bargeIn).not.toHaveBeenCalled()
  })

  it('reports speaking state while the agent holds the floor', () => {
    const { tm } = harness()
    tm.onAgentSpeakStart('u1', [{ word: 'Hello', startMs: 0, endMs: 300 }])
    expect(tm.state).toBe('speaking')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/core test -- turn-manager`
Expected: FAIL — `TurnManager` is not defined.

- [ ] **Step 3: Implement `TurnManager`**

Holds `state`, `lastPartial`, `lastLang`, `silenceStartedAt`, `activeUtterance`. `tick()` compares `now() - silenceStartedAt` against `silenceThresholdMs({...})` and emits `endpoint` exactly once per turn (guard with a `pendingEndpoint` flag cleared on `onVadSpeechStart`). `onVadSpeechStart` while `state === 'speaking'` emits `bargeIn` with the last reported `playedMs` for the active utterance.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/core test -- turn-manager`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/turn-manager.ts packages/core/src/transport.ts packages/core/src/turn-manager.test.ts
git commit -m "feat: turn manager with VAD fusion and barge-in orchestration"
```

---

## Task 7: Local provider adapters (whisper.cpp, Ollama, Piper)

**Files:**
- Create: `packages/providers/src/stt/whisper-cpp.ts`, `src/llm/ollama.ts`, `src/tts/piper.ts`
- Create: `scripts/setup-local-models.sh`
- Test: `packages/providers/src/tts/piper.test.ts` (word-mark derivation), `src/llm/ollama.test.ts` (tool-call parsing)

**Interfaces:**
- Produces: `WhisperCppStt`, `OllamaLlm`, `PiperTts` — each implementing its Task 4 interface.

**Note on Piper word marks:** Piper does not emit word timings. Derive them by distributing the synthesised duration across words weighted by character count. Approximate, but barge-in truncation only needs word-boundary resolution, and this keeps the local tier honest rather than silently dropping the feature.

- [ ] **Step 1: Write the failing word-mark test**

`packages/providers/src/tts/piper.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deriveWordMarks } from './piper'

describe('deriveWordMarks', () => {
  it('spans the full duration', () => {
    const marks = deriveWordMarks('doctor sharma is available', 2000)
    expect(marks[0]!.startMs).toBe(0)
    expect(marks.at(-1)!.endMs).toBe(2000)
  })

  it('emits one mark per word', () => {
    expect(deriveWordMarks('doctor sharma is available', 2000)).toHaveLength(4)
  })

  it('gives longer words more time', () => {
    const [a, , c] = deriveWordMarks('a bb cccccc', 1000)
    expect(c!.endMs - c!.startMs).toBeGreaterThan(a!.endMs - a!.startMs)
  })

  it('produces contiguous, non-overlapping marks', () => {
    const marks = deriveWordMarks('one two three four', 1200)
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]!.startMs).toBe(marks[i - 1]!.endMs)
    }
  })

  it('handles a single word', () => {
    expect(deriveWordMarks('haan', 300)).toEqual([{ word: 'haan', startMs: 0, endMs: 300 }])
  })

  it('handles empty text', () => {
    expect(deriveWordMarks('', 300)).toEqual([])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/providers test -- piper`
Expected: FAIL — `deriveWordMarks` is not defined.

- [ ] **Step 3: Implement `deriveWordMarks` and the three adapters**

```ts
export function deriveWordMarks(text: string, totalMs: number): WordMark[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const total = words.reduce((n, w) => n + w.length, 0)
  const marks: WordMark[] = []
  let cursor = 0
  words.forEach((word, i) => {
    const isLast = i === words.length - 1
    const endMs = isLast ? totalMs : Math.round(cursor + (word.length / total) * totalMs)
    marks.push({ word, startMs: Math.round(cursor), endMs })
    cursor = endMs
  })
  return marks
}
```

`WhisperCppStt` spawns/attaches to the whisper.cpp server, streams 16 kHz PCM in ~500 ms windows with a rolling context, emits `partial` per window and `final` on `end()`. `OllamaLlm` streams `/api/chat` with `tools`, parsing tool calls from the stream. `PiperTts` spawns `piper` with the language-matched voice model and pipes PCM out.

`scripts/setup-local-models.sh` fetches whisper `large-v3-turbo` (Metal build), `ollama pull qwen3:8b`, and Piper `hi_IN` + `en_IN` voices — idempotent, safe to re-run.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/providers test`
Expected: PASS — 6 piper tests plus the 4 registry tests from Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/providers scripts/setup-local-models.sh
git commit -m "feat: local provider tier — whisper.cpp, Ollama, Piper"
```

---

## Task 8: Cloud provider adapters + phrase cache

**Files:**
- Create: `packages/providers/src/stt/deepgram.ts`, `src/llm/gemini.ts`, `src/tts/elevenlabs.ts`, `src/tts/phrase-cache.ts`
- Create: `scripts/build-phrase-cache.ts`, `packages/providers/src/tts/phrases.ts`
- Test: `packages/providers/src/tts/phrase-cache.test.ts`

**Interfaces:**
- Produces: `DeepgramStt`, `GeminiLlm`, `ElevenLabsTts`, `CachedTts` (decorator: `new CachedTts(inner, cacheDir)`), `PHRASES: Record<PhraseKey, Record<Lang, string>>`

**The phrase cache is a decorator, not a provider.** It wraps any `TtsProvider`, so it works identically over ElevenLabs and Piper.

- [ ] **Step 1: Write the failing cache tests**

`packages/providers/src/tts/phrase-cache.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { CachedTts, cacheKey } from './phrase-cache'

describe('cacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).toBe(cacheKey('hello', 'v1', 'en-IN', 'flash'))
  })
  it('changes when the voice changes', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).not.toBe(cacheKey('hello', 'v2', 'en-IN', 'flash'))
  })
  it('changes when the language changes', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).not.toBe(cacheKey('hello', 'v1', 'hi-IN', 'flash'))
  })
  it('changes when the model changes so edits invalidate', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).not.toBe(cacheKey('hello', 'v1', 'en-IN', 'turbo'))
  })
})

describe('CachedTts', () => {
  it('does not call the inner provider on a cache hit', async () => {
    const inner = { id: 'stub', tier: 'cloud' as const, isAvailable: async () => true, synth: vi.fn() }
    const tts = new CachedTts(inner, '/tmp/vaani-test-cache')
    await tts.warm('namaste', { voice: 'v1', lang: 'hi-IN', model: 'flash' })
    inner.synth.mockClear()
    await tts.synth('namaste', { voice: 'v1', lang: 'hi-IN', model: 'flash' })
    expect(inner.synth).not.toHaveBeenCalled()
  })

  it('falls through to the inner provider on a miss', async () => {
    const inner = { id: 'stub', tier: 'cloud' as const, isAvailable: async () => true, synth: vi.fn() }
    const tts = new CachedTts(inner, '/tmp/vaani-test-cache')
    await tts.synth('an unseen sentence', { voice: 'v1', lang: 'en-IN', model: 'flash' })
    expect(inner.synth).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/providers test -- phrase-cache`
Expected: FAIL — cannot resolve `./phrase-cache`.

- [ ] **Step 3: Implement the cache and the phrase set**

`cacheKey` = sha256 of the four inputs, hex, first 16 chars. Cached entries store `<key>.pcm` plus `<key>.marks.json`.

`phrases.ts` defines every phrase in all three `Lang` values, keyed by intent — `greeting`, `greetingReturning`, `hold`, `holdLong`, `backchannel`, `confirmSlot`, `confirmBooked`, `askName`, `askPhone`, `notUnderstood`, `closing`, `emergencyRed`, `transferring`, and so on. Target ~60 keys.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/providers test`
Expected: PASS — 6 cache tests plus prior suites.

- [ ] **Step 5: Commit**

```bash
git add packages/providers scripts/build-phrase-cache.ts
git commit -m "feat: cloud provider tier and pre-rendered phrase cache"
```

---

## Task 9: Session — wire transport, pipeline, and history together

**Files:**
- Create: `packages/core/src/session.ts`
- Test: `packages/core/src/session.test.ts`

**Interfaces:**
- Consumes: `Transport`, `TurnManager`, `ProviderRegistry`, `truncateToPlayed`
- Produces: `class Session { constructor(o: SessionOptions); start(): Promise<void>; get history(): Message[] }`

**The property this task exists to guarantee:** after a barge-in, `session.history` contains only the words the caller actually heard.

- [ ] **Step 1: Write the failing integration test**

`packages/core/src/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Session } from './session'
import { FakeTransport, fakeProviders } from './testing/fakes'

describe('Session', () => {
  it('completes a full turn: audio in, agent reply out', async () => {
    const t = new FakeTransport()
    const s = new Session({ transport: t, providers: fakeProviders({ reply: 'Sure, I can help.' }) })
    await s.start()
    await t.speak('I need an appointment')
    await t.settle()
    expect(t.spokenByAgent()).toContain('Sure, I can help.')
  })

  it('records only the heard prefix in history after a barge-in', async () => {
    const t = new FakeTransport()
    const s = new Session({
      transport: t,
      providers: fakeProviders({ reply: 'Doctor Sharma is available Thursday' }),
    })
    await s.start()
    await t.speak('when is the doctor free')
    await t.playUntil(1000)           // caller heard "Doctor Sharma is"
    await t.interrupt()
    await t.settle()
    const lastAgent = s.history.filter((m) => m.role === 'assistant').at(-1)!
    expect(lastAgent.content).toBe('Doctor Sharma is—')
    expect(lastAgent.content).not.toContain('Thursday')
  })

  it('stops sending audio immediately on barge-in', async () => {
    const t = new FakeTransport()
    const s = new Session({ transport: t, providers: fakeProviders({ reply: 'a long spoken sentence here' }) })
    await s.start()
    await t.speak('hello')
    await t.playUntil(200)
    await t.interrupt()
    const sentAtInterrupt = t.audioBytesSent()
    await t.settle()
    expect(t.audioBytesSent()).toBe(sentAtInterrupt)
  })

  it('appends the interrupting caller turn after the truncated agent turn', async () => {
    const t = new FakeTransport()
    const s = new Session({ transport: t, providers: fakeProviders({ reply: 'Doctor Sharma is available Thursday' }) })
    await s.start()
    await t.speak('when is the doctor free')
    await t.playUntil(1000)
    await t.interruptWith('actually make it Friday')
    await t.settle()
    const roles = s.history.map((m) => m.role)
    expect(roles.slice(-3)).toEqual(['user', 'assistant', 'user'])
    expect(s.history.at(-1)!.content).toBe('actually make it Friday')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/core test -- session`
Expected: FAIL — cannot resolve `./session`.

- [ ] **Step 3: Implement `Session` and the fakes**

`Session` subscribes to `TurnManager` events. On `endpoint`: set `thinking`, stream LLM, feed sentence-complete chunks to TTS as they arrive (do not wait for the full completion — this is where most of the latency win lives), forward audio through the transport, emit `metrics.turn`. On `bargeIn`: cancel the TTS stream and the LLM stream, run `truncateToPlayed`, rewrite the last assistant message, return to `listening`.

`testing/fakes.ts` provides `FakeTransport` (scriptable caller audio, byte accounting, playback simulation) and `fakeProviders` (deterministic STT/LLM/TTS with synthetic word marks).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaani/core test`
Expected: PASS — 4 session tests plus the endpointing, truncation, and turn-manager suites.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: session core with barge-in-accurate conversation history"
```

---

## Task 10: Voice server + browser client — first real conversation

**Files:**
- Create: `apps/voice-server/package.json`, `src/index.ts`, `src/ws-transport.ts`, `src/session-registry.ts`
- Create: `apps/web/` (Next.js 16 scaffold), `app/page.tsx`, `lib/voice-client.ts`, `public/worklets/vad-processor.js`
- Test: `apps/voice-server/src/ws-transport.test.ts`

**Interfaces:**
- Produces: `WsTransport implements Transport`, `VoiceClient` (browser: mic capture → AudioWorklet VAD → WS; WS audio → playback with position reporting)

- [ ] **Step 1: Write the failing transport test**

`apps/voice-server/src/ws-transport.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { WsTransport } from './ws-transport'
import { FakeSocket } from './testing/fake-socket'

describe('WsTransport', () => {
  it('forwards binary frames as PCM audio', () => {
    const sock = new FakeSocket()
    const t = new WsTransport(sock)
    const onAudio = vi.fn()
    t.onAudioFrame(onAudio)
    sock.emitBinary(new Int16Array([1, 2, 3]).buffer)
    expect(onAudio).toHaveBeenCalledOnce()
  })

  it('rejects malformed control messages without closing the socket', () => {
    const sock = new FakeSocket()
    const t = new WsTransport(sock)
    sock.emitText('{"type":"garbage"}')
    expect(sock.closed).toBe(false)
  })

  it('serialises server events as JSON text', () => {
    const sock = new FakeSocket()
    const t = new WsTransport(sock)
    t.send({ type: 'agent.state', state: 'listening' })
    expect(JSON.parse(sock.sentText[0]!)).toMatchObject({ type: 'agent.state' })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @vaani/voice-server test`
Expected: FAIL — cannot resolve `./ws-transport`.

- [ ] **Step 3: Implement server and browser client**

`WsTransport` implements `Transport` over `ws`: binary → `onAudioFrame`, text → `parseClientEvent` (invalid input logged and dropped, never fatal), `send()` → JSON or binary.

Browser `VoiceClient`: `getUserMedia` → `AudioContext(16000)` → AudioWorklet running Silero VAD via onnxruntime-web, posting `vad.speech_start`/`vad.speech_end` and PCM frames. Playback queues incoming audio and posts `playback.progress` every 50 ms; on barge-in it ramps gain to 0 over 60 ms before stopping — the ramp is what stops it sounding like a dropped call.

- [ ] **Step 4: Run tests, then verify manually**

Run: `pnpm --filter @vaani/voice-server test` → PASS, 3 tests.

Then, end-to-end:
```bash
./scripts/setup-local-models.sh
pnpm dev
```
Open `http://localhost:3000`, allow the mic, and say "I need to book an appointment."
Expected: transcript appears, agent replies in audio, and interrupting mid-reply stops playback within ~120 ms and visibly truncates the agent's transcript line.

- [ ] **Step 5: Commit**

```bash
git add apps/
git commit -m "feat: voice server and browser client — end-to-end conversation"
```

---

## Roadmap — subsequent plans

Each gets its own plan document when reached. Listed here so task boundaries in this
plan are drawn with them in view.

**Plan 2 — Agent brain (spec §5).** Conversation policy prompt; the 13 tools; scheduling
engine (provider × operatory × duration × buffer slot solver); RAG over the seeded KB
with hybrid retrieval and a grounding threshold; language detection and mirroring;
number/date normalisation both directions; the three-layer safety guard and triage
bands. Golden-transcript eval harness lands here — ~40 scripted conversations asserted
on final state, tools called, and safety.

**Plan 3 — Frontend (spec §7).** Design system and tokens; the canvas voice orb driven
by real `AnalyserNode` FFT; dual-track transcript synced to playback position with
strike-through on interruption; latency HUD; tool-call cards; live practice panel;
then call history, analytics, agent studio, KB manager, channels. Load the
`frontend-design` skill before starting — the visual direction is a deliverable here,
not decoration.

**Plan 4 — Production polish.** Phrase-cache build integration; scripted demo mode;
call recording and playback with waveform scrubbing; analytics pipeline; latency
regression suite in CI.

**Plan 5 — Channels (spec §8).** `TwilioTransport` (μ-law 8 kHz transcode, `mark`
events); `WhatsAppTransport` (half-duplex, barge-in disabled); outbound campaigns —
reminders, recall, waitlist auto-fill.

---

## Self-Review

**Spec coverage.** §2 architecture → Tasks 1, 4, 6, 9, 10. §3 turn-taking → Tasks 2, 3,
6, 9. §4 providers and phrase cache → Tasks 4, 7, 8. §6 data → Task 5. §5 agent, §7
frontend, §8 channels, §10 testing → Plans 2–5, scoped above. §11 risks are mitigated in
the tasks that carry them (Piper word marks in Task 7, downgrade-never-throw in Task 4).

**Placeholder scan.** No TBDs. Every code step carries real code; every test step carries
real assertions.

**Type consistency.** `WordMark`, `Lang`, `Tier`, `TurnState`, and `Message` are defined
once in Tasks 1/2/4/6 and referenced with identical names thereafter. `truncateToPlayed`
returns `{ spoken, wasTruncated }` in Task 3 and is destructured that way in Task 9.
`silenceThresholdMs` takes `EndpointContext` in Task 2 and is called with that shape in
Task 6.
