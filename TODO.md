# Vaani — migration to Gemini Live

## Why

The real-estate agent sounds human because it uses **Gemini Live native audio**:
speech in, speech out, one model. Vaani was built as a cascaded pipeline —
STT → LLM → TTS — which is three lossy hops where the synthesiser never knows
what the sentence meant. No amount of tuning closes that gap.

Verified working on this key (`gemini-3.1-flash-live-preview`):
- native audio out, 24 kHz PCM
- tool calling: `check_availability({"service":"scaling"})` → used the result correctly
- reply: *"Scaling ke liye Thursday 10 am ka slot available hai Dr Sharma ke saath, kya woh aapko chalega?"*

## Decisions

- [x] **Voice** — Leda. Kore / Leda / Zephyr auditioned; Aoede is the
      real-estate agent's, so not that one.
- [x] Model: `gemini-3.1-flash-live-preview`
- [x] Key: authorised and working

## Delete — replaced natively by Live (~2,200 lines)

- [ ] `packages/providers/src/{groq,cloud,local,hallucination,hinglish}.ts` — STT/TTS
- [ ] `packages/core/src/{turn-manager,endpointing}.ts` — Live's `automaticActivityDetection`
- [ ] `packages/core/src/{chunker,truncation}.ts` — audio streams natively; `interrupted` event
- [ ] `packages/core/src/session.ts` — the cascaded orchestrator
- [ ] `apps/web/public/vad-worklet.js`, `apps/web/lib/voice-client.ts` — Live does VAD server-side
- [ ] their tests

## Keep — this is the dental product, not the pipeline

- `packages/agent/src/practice.ts` — slot solver (provider × chair × duration × buffer), atomic booking, reschedule
- `packages/agent/src/clinic-data.ts` — 3 branches, 6 doctors with qualifications, 12 treatments
- `packages/agent/src/knowledge.ts` — grounded retrieval with a refusal threshold
- `packages/agent/src/triage.ts` — deterministic RED/AMBER/GREEN emergency bands
- `packages/agent/src/safety.ts` — clinical guard (still needed: Live can say anything)
- `packages/agent/src/tools.ts` — the 13 dental tools
- `packages/agent/src/conversation-state.ts` — typed memory
- `apps/web/components/*` + `globals.css` — the console and the Porcelain design system

## Build

- [ ] `packages/live/src/config.ts` — `buildLiveConfig()`: dental `customVocabulary`,
      `languageCodes` pinning, VAD tuning, `contextWindowCompression`, `sessionResumption`
- [ ] `packages/live/src/session.ts` — wraps `ai.live.connect`, maps Live events onto the
      existing `ServerEvent` protocol so the console keeps working
- [ ] `packages/live/src/prompt.ts` — system instruction with the PRD persona rules,
      injecting `describeConversation()` state each turn
- [ ] tool bridge — `DentalTools` → Gemini `functionDeclarations` / `sendToolResponse`
- [ ] `apps/web/lib/live-client.ts` — mic capture + gapless playback + flush on `interrupted`
- [ ] rewire `apps/voice-server` onto the Live session

## Verify

- [ ] scripted conversation suite passes against Live
- [ ] browser audit: language switch mid-call changes voice *and* language
- [ ] no invented doctors or prices (smoke test hallucinated "Dr. Desai" with no tools wired —
      must be gone once knowledge and tools are connected)

## Borrowed from the real-estate repo, credited

- ephemeral-token pattern: the browser gets a credential, not a configuration
- `customVocabulary` for terms ASR mangles
- `languageCodes` ordering — first entry is the primary ASR hypothesis
- `contextWindowCompression` so long calls don't drop
