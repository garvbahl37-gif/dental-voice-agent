# Vaani — AI Front Desk for Dental Practices

**Design document** · 2026-08-17

---

## 1. Product definition

Vaani is a production-grade, multilingual voice agent that acts as the front desk for a
dental practice. It answers the phone, identifies the caller, books / reschedules /
cancels appointments against real chair availability, answers questions about the
practice from a grounded knowledge base, triages dental emergencies to a safe
escalation path, and hands off to a human when it should.

It speaks Hindi, English, and — critically — **Hinglish**, the code-switched register
that most Indian callers actually use.

The agent persona is **Priya**, receptionist at the configured practice.

### 1.1 What "really good" means here — measurable targets

| Dimension | Target |
|---|---|
| End-to-end response latency (cloud tier, p50) | ≤ 700 ms mouth-to-ear |
| End-to-end response latency (cloud tier, p95) | ≤ 1100 ms |
| Barge-in reaction (user speaks → agent audio stops) | ≤ 120 ms |
| Cached-phrase latency | ≤ 30 ms |
| Booking task completion without human handoff | ≥ 85 % |
| Language mirroring accuracy (turn-level) | ≥ 95 % |
| Clinical safety violations (diagnosis / prescription) | 0 — hard-blocked |

### 1.2 Non-goals

- Vaani never diagnoses, never prescribes, never quotes a clinical outcome.
- Vaani is not an EHR. It integrates with one; it does not replace one.
- No payment capture over voice in v1 (PCI scope avoided deliberately).

---

## 2. Architecture

### 2.1 The one structural idea

Every channel Vaani will ever support — browser demo, Twilio PSTN, WhatsApp voice — is
the same shape: **a duplex stream of audio frames plus a control channel.**

So there is exactly one `Session` implementation containing all turn-taking, barge-in,
agent, and tool logic. Channels are `Transport` adapters. Adding Twilio is an adapter,
not a rewrite.

```
                    ┌───────────────────────────────────────┐
  Browser  ────────▶│                                       │
  (WebAudio)        │            Transport                  │
                    │            interface                  │
  Twilio    ────────▶│  onAudioFrame / send / close / dtmf   │
  (Media Streams)   │                                       │
                    └──────────────────┬────────────────────┘
  WhatsApp  ────────▶                  │
  (voice notes)                        ▼
                    ┌───────────────────────────────────────┐
                    │              Session                  │
                    │  ┌─────────────────────────────────┐  │
                    │  │  TurnManager                    │  │
                    │  │   · VAD fusion (client+server)  │  │
                    │  │   · adaptive endpointing        │  │
                    │  │   · barge-in + truncation       │  │
                    │  │   · backchannel scheduler       │  │
                    │  └─────────────────────────────────┘  │
                    │  ┌─────────────────────────────────┐  │
                    │  │  Pipeline (STT → LLM → TTS)     │  │
                    │  │   via ProviderRegistry          │  │
                    │  └─────────────────────────────────┘  │
                    │  ┌─────────────────────────────────┐  │
                    │  │  Agent (policy, tools, RAG,     │  │
                    │  │  language, safety guard)        │  │
                    │  └─────────────────────────────────┘  │
                    └──────────────────┬────────────────────┘
                                       ▼
                        Scheduling · Patients · KB · Tasks
                                    (SQLite / Postgres)
```

### 2.2 Repository layout

pnpm workspaces + Turborepo.

```
vaani/
├── apps/
│   ├── web/                  Next.js 16 App Router — console, dashboard, studio
│   └── voice-server/         Long-lived Node WS server (sessions, pipeline, transports)
├── packages/
│   ├── shared/               Wire protocol, zod schemas, shared types
│   ├── core/                 Session, TurnManager, barge-in, audio utils
│   ├── providers/            STT/LLM/TTS registry + adapters (local & cloud)
│   ├── agent/                Prompts, tools, RAG, language policy, safety guard
│   ├── db/                   Drizzle schema, migrations, seed data
│   └── ui/                   Design system: tokens, primitives, audio-viz
├── services/
│   └── local-stt/            whisper.cpp launcher + model fetch
├── scripts/                  phrase-cache builder, model setup, seed
└── docs/
```

**Why `voice-server` is separate from `web`:** the audio pipeline is stateful and
long-lived, holds model handles and open provider sockets, and spawns local sidecars.
That is a persistent process (Docker / Fly / Railway / a box), not a serverless
function. `web` deploys to Vercel and talks to it over WebSocket.

### 2.3 Wire protocol (`packages/shared`)

Typed, zod-validated, versioned. Binary frames for audio, JSON for control.

**Client → Server**

| Event | Payload |
|---|---|
| `session.start` | `{ channel, locale?, patientHint?, tier? }` |
| `audio.frame` | binary — PCM16 mono 16 kHz (browser) / μ-law 8 kHz (Twilio) |
| `vad.speech_start` | `{ t }` — client-side Silero, low latency |
| `vad.speech_end` | `{ t }` |
| `playback.progress` | `{ utteranceId, playedMs }` — **drives truncation** |
| `control.interrupt` | `{}` |
| `control.dtmf` | `{ digit }` |
| `session.end` | `{}` |

**Server → Client**

| Event | Payload |
|---|---|
| `session.ready` | `{ sessionId, agent, voice, tier }` |
| `stt.partial` | `{ text, lang, confidence }` |
| `stt.final` | `{ turnId, text, lang }` |
| `agent.state` | `{ state: idle\|listening\|thinking\|speaking\|tool_running }` |
| `agent.token` | `{ turnId, text }` — streaming |
| `tts.begin` | `{ utteranceId, text, marks: WordMark[] }` |
| `tts.chunk` | binary audio |
| `tts.cancel` | `{ utteranceId, truncateAtMs }` |
| `tool.call` / `tool.result` | `{ id, name, args }` / `{ id, result, ms }` |
| `metrics.turn` | `{ sttMs, llmTtftMs, ttsTtfbMs, e2eMs, tier, cached }` |
| `ui.event` | `{ type, payload }` — drives live dashboard |

`ui.event` is what makes the demo feel alive: the calendar visibly fills the instant
`book_appointment` succeeds.

---

## 3. Turn-taking — the human-ness engine

This is where a voice agent is won or lost. Four mechanisms.

### 3.1 VAD fusion

Client-side **Silero VAD** (ONNX, ~1 MB, in an AudioWorklet, 30 ms frames) fires
`vad.speech_start` immediately — no network round trip. The server treats it as a
*hint* and confirms against its own energy+STT-partial signal to reject coughs, door
slams, and TV audio. Client speed, server accuracy.

### 3.2 Adaptive endpointing

A fixed silence threshold is the single biggest cause of an agent feeling robotic —
it either interrupts you mid-thought or leaves dead air.

```
base                                        600 ms
after agent asked an open question         +300 ms   ("how can I help you?")
after agent asked a yes/no question        -150 ms
partial ends in a filler                   +400 ms   (um, uh, matlab, toh, woh)
partial is semantically incomplete         +500 ms   ("my name is", "mera number hai")
mid-number-sequence                        +500 ms   (phone numbers, dates)
user has been silent > 6 s                  prompt gently
```

Semantic incompleteness uses a fast rule set first (trailing connectives, dangling
possessives, digit runs shorter than expected); only ambiguous cases cost an LLM call.

### 3.3 Barge-in with playback-accurate truncation

**The problem nobody handles:** you interrupt the agent 1.2 s into a 4 s sentence. Most
systems keep the *entire* generated sentence in conversation history. The agent now
believes it told you something you never heard — and every subsequent turn is built on
a false record. It will say "as I mentioned, Dr. Sharma is available Thursday" when it
never got past "Dr. Sharma is—".

**The fix:**

1. Client VAD detects speech during agent playback.
2. Client stops playback immediately, ramping gain to 0 over ~60 ms (avoids the click
   that makes cheap agents sound broken), and reports `playback.progress { playedMs }`.
3. Server cancels the TTS stream and the in-flight LLM completion.
4. Server maps `playedMs` onto the TTS **word-timing marks** to find exactly which
   words left the speaker.
5. Server rewrites the assistant message in history to the spoken prefix + `—`.
6. The interrupting user turn proceeds against a truthful record.

The UI renders this: the unspoken remainder of the agent's line visibly strikes through.

### 3.4 Backchannels and thinking sounds

- User speaking continuously > 4 s → emit a cached `"mm-hmm"` / `"जी"` at a prosodic
  pause. Costs nothing (phrase cache), enormous perceived-presence gain.
- Tool call exceeding 400 ms → play a cached hold phrase in the active language
  ("one second, let me check that…" / "एक सेकंड, मैं देखती हूँ…"). Dead air during a
  database query is the most common tell that you're talking to a machine.

---

## 4. Provider layer — two tiers, one interface

```ts
interface SttProvider  { stream(opts): SttStream }   // partial + final + lang
interface LlmProvider  { stream(msgs, tools): LlmStream }
interface TtsProvider  { synth(text, voice, lang): TtsStream } // audio + word marks
```

| Stage | LOCAL ($0) | CLOUD (quality) |
|---|---|---|
| STT | whisper.cpp `large-v3-turbo`, Metal-accelerated | Sarvam Saarika (best-in-class Indic + code-switch) or Deepgram Nova-3 |
| LLM | Ollama `qwen3:8b` (strong Hindi + tool calling) | Gemini 2.5 Flash |
| TTS | Piper (hi_IN + en_IN voices) | ElevenLabs Flash v2.5 (~75 ms TTFB) |

Tier is selectable **per component** at runtime — local STT + cloud TTS is a perfectly
sensible production config (STT is the expensive-per-minute one; TTS is where
human-ness lives).

The console surfaces the switch live with a side-by-side latency readout. That is
simultaneously a debugging tool and the most persuasive thing in the demo.

### 4.1 Phrase cache

`scripts/build-phrase-cache.ts` pre-renders ~60 high-frequency utterances through
ElevenLabs at build time, per language, to `apps/voice-server/cache/phrases/`, with
word-timing marks stored alongside. Greetings, confirmations, holds, backchannels,
closings, error recovery, the emergency script.

Result: the majority of utterances in a typical call play back in under 30 ms at zero
marginal cost, in the premium voice. Only genuinely dynamic content (names, times,
knowledge answers) hits an API or the local TTS.

Cache keys on `(text, voiceId, lang, modelId)` so edits invalidate correctly.

---

## 5. The agent

### 5.1 Conversation policy — soft state, not a rigid graph

```
GREET → IDENTIFY → INTENT → { BOOK | RESCHEDULE | CANCEL | INFO | TRIAGE | HANDOFF }
      → CONFIRM → CLOSE
```

State is injected into the prompt as a **hint**, never as a hard gate. Rigid state
machines are exactly what makes IVR feel like IVR — a caller who says "actually, before
that, do you take Star Health?" mid-booking must be answered and returned, not refused.

### 5.2 Tools

| Tool | Purpose |
|---|---|
| `lookup_patient` | by phone, or name + DOB |
| `create_patient` | new caller intake |
| `list_services` | procedures, durations, price ranges |
| `check_availability` | service- and provider-aware slot search |
| `book_appointment` | writes appointment, emits `ui.event` |
| `reschedule_appointment` / `cancel_appointment` | with 24 h policy handling |
| `join_waitlist` | auto-fill when a cancellation opens |
| `search_knowledge` | grounded RAG over practice docs |
| `triage_symptoms` | returns severity band + mandated script |
| `escalate_to_human` | warm transfer / callback task |
| `send_confirmation` | SMS / WhatsApp + calendar invite |
| `record_note` | free-text note onto the call record |
| `set_language` | explicit language switch |

### 5.3 Scheduling engine

Not a toy calendar. Providers × operatories (chairs) × procedure durations × buffers ×
practice hours × holidays × provider time-off. `check_availability` solves for a slot
where provider **and** chair are both free for the procedure's full duration plus
turnaround buffer.

Procedure-aware durations: cleaning 30 min, filling 45 min, root canal 90 min,
consultation 20 min, emergency 30 min.

**Waitlist auto-fill** — when a cancellation frees a slot, matching waitlisted patients
are queued for outbound contact. This is the highest-ROI feature in the product and the
one that makes a practice owner lean forward.

### 5.4 Knowledge base (RAG)

Practice documents → chunk → embed → hybrid retrieval (BM25 + vector). Local:
`sqlite-vec` + a local embedding model. Production: pgvector + Gemini embeddings.

Grounding rule: answers must cite a retrieved chunk. Below the relevance threshold the
agent says so and creates a callback task — it does not improvise. Practice pricing and
insurance answers are exactly where an ungrounded model will invent numbers and cost the
client real money.

### 5.5 Clinical safety — three independent layers

1. **System prompt rails** — explicit prohibition on diagnosis, prescription, prognosis.
2. **`triage_symptoms` owns all clinical routing** — the model does not decide urgency;
   it calls the tool, and the tool returns a mandated script.
3. **Post-generation guard** — pattern + classifier check on every outgoing utterance.
   A violation is replaced with a safe deferral before a single sample is synthesised.

Triage bands:

| Band | Examples | Action |
|---|---|---|
| **RED** — emergency | facial swelling near eye/throat, difficulty breathing/swallowing, uncontrolled bleeding, avulsed tooth, jaw trauma | Immediate: direct to emergency care, offer to connect on-call dentist, alert practice |
| **AMBER** — urgent | severe pain, abscess, broken tooth with pain, lost crown | Same/next-day slot, flag to provider |
| **GREEN** — routine | cleaning, checkup, cosmetic enquiry, mild sensitivity | Normal booking flow |

An avulsed (knocked-out) tooth has a ~30-minute viability window. Getting this wrong is
the one failure mode in this product with a real human cost, so it is hard-coded, not
prompted.

### 5.6 Language policy

- Detect language per **turn** (STT signal + light classifier), not per session.
- **Mirror the caller.** Hinglish in → Hinglish out.
- Preserve the caller's own form for proper nouns, numbers, and times.
- **One voice ID across all languages** — a voice that changes identity mid-call
  instantly breaks the illusion.
- Persist `preferredLanguage` on the patient record; greet in it on the next call.
- Number/date normalisation both directions: "parso", "agle hafte", "साढ़े तीन बजे",
  Devanagari digits, Indian phone-number groupings.

---

## 6. Data model

SQLite + Drizzle locally; Postgres (Neon) in production. Same schema.

`practices` · `providers` · `operatories` · `services` · `provider_schedules` ·
`time_off` · `patients` · `appointments` · `waitlist` · `calls` · `call_turns` ·
`kb_documents` · `kb_chunks` · `tasks` · `consents` · `audit_log`

Seeded with a realistic practice: 3 dentists, 4 chairs, 12 services, ~40 patients with
Indian names and mixed language preferences, 2 weeks of existing appointments, and a
populated knowledge base. **A demo dies on empty state** — the seed is a deliverable,
not an afterthought.

### 6.1 Compliance posture

- Call-recording consent announced in the greeting, per language, and logged.
- PII redacted in application logs (phone, DOB, name → tokens).
- `audit_log` on every read/write of patient data.
- Retention policy configurable; audio retention separable from transcript retention.
- Designed toward HIPAA / India DPDP alignment. v1 is not certified — it is
  *architected so certification is possible*, which is the honest claim.

---

## 7. Frontend

### 7.1 Design direction — "Clinical Midnight"

Dark-first, near-black with a cool blue-green undertone. Layered surfaces separated by
1 px hairlines rather than heavy shadows — instrument-panel precision, not a SaaS
dashboard template.

- **Base** deep charcoal-teal · **Primary** mint/aqua (clean, clinical, trustworthy)
- **Speaking** warm amber — the one warm colour, reserved for when Priya has the floor
- **Alert** coral, reserved exclusively for triage escalation
- **Type** Instrument Sans (UI) · Instrument Serif (display moments) ·
  Geist Mono (telemetry) · Noto Sans Devanagari (Hindi transcript)

Explicitly avoiding the default shadcn-violet / Inter / rounded-card look — this has to
read as a product with a point of view, not a scaffold.

### 7.2 Screen 1 — Live Call Console (the hero)

**The voice orb.** Not a generic blob. A concentric ring instrument driven by real
`AnalyserNode` FFT at 60 fps on canvas:

- inner core — pulses with agent TTS amplitude
- radial bar ring — live frequency spectrum
- outer halo — fills with the caller's mic energy
- colour and motion shift per state: idle / listening / thinking / speaking
- on barge-in the two collide: agent rings snap inward, caller halo flares

**Dual-track transcript.** Caller turns (interim grey → final) and agent turns
streaming token-by-token, *synchronised to audio playback position* — words land as
they're spoken, not as they're generated. On barge-in, the unspoken remainder strikes
through. That single visual sells the whole engineering story.

**Latency HUD.** Per-turn waterfall — STT → LLM TTFT → TTS TTFB → first audio — with
the serving tier badged per stage and a `CACHED` flag when the phrase cache hit.

**Tool call cards.** Inline, with arguments and results, as they fire.

**Language chip.** Flips हिन्दी ⇄ English live as code-switching is detected.

**Live practice panel.** Calendar that visibly fills the moment a booking commits;
patient card populating field-by-field as details are extracted; triage banner on
escalation.

### 7.3 Remaining screens

| Screen | Contents |
|---|---|
| **Call History** | recordings, waveform scrubbing synced to transcript, per-turn metrics, sentiment, QA score |
| **Practice Dashboard** | calendar, providers, chairs, waitlist, tasks |
| **Analytics** | booking conversion, containment rate, avg handle time, language mix, triage distribution, latency percentiles, cost per call by tier |
| **Agent Studio** | persona, voice picker with preview, prompt editor, tool toggles, tier selector, endpointing tuning — all live-editable |
| **Knowledge Base** | document upload, chunk inspector, retrieval test bench |
| **Channels** | Web / Twilio / WhatsApp status and configuration |

### 7.4 Demo mode

A one-click **scripted-caller** mode: plays pre-recorded caller audio (including a
deliberate mid-sentence interruption and a Hinglish code-switch) through the real
pipeline. Every demo lands the same way, no microphone roulette, and the barge-in
moment is guaranteed to happen while the client is watching.

---

## 8. Channel expansion

**Twilio** — Media Streams is a WebSocket carrying base64 μ-law 8 kHz frames. The
adapter handles codec transcode (μ-law 8 k ⇄ PCM 16 k) and Twilio's `mark` events for
playback position. `TwilioTransport implements Transport`. Everything else is untouched.

**WhatsApp** — Cloud API voice notes: receive → transcribe → agent → synthesise →
upload → reply. Half-duplex, so the same `Session` runs with barge-in disabled and
longer endpointing. Also carries confirmations, reminders, and waitlist offers.

Both are adapters against an interface built for them from day one — not retrofits.

---

## 9. Build phases

| Phase | Deliverable |
|---|---|
| **0 — Foundation** | Monorepo, design system + tokens, Drizzle schema, seed data, wire protocol |
| **1 — Voice core** | Transport abstraction, VAD, adaptive endpointing, barge-in + truncation, provider registry, both tiers wired |
| **2 — Agent brain** | Policy, all tools, scheduling engine, RAG, language policy, safety guard, triage |
| **3 — Frontend** | Live console (orb, transcript, HUD, tool cards), practice dashboard, studio, analytics, KB manager |
| **4 — Production polish** | Phrase cache, demo mode, call history + playback, analytics pipeline, eval harness |
| **5 — Channels** | Twilio adapter, WhatsApp adapter, outbound campaigns (reminders, recall, waitlist auto-fill) |

Each phase ends runnable. Phase 3 is the first point at which the whole thing is
demoable end-to-end.

---

## 10. Testing

- **Unit** — endpointing decisions, truncation maths, slot solver, number/date
  normalisation, safety guard.
- **Golden-transcript evals** — ~40 scripted conversations (Hindi, English, Hinglish;
  booking, reschedule, price enquiry, insurance, each triage band, human handoff,
  hostile/confused caller) asserted on final state, tools called, and safety.
- **Audio fixtures** — recorded caller audio replayed through the real pipeline for
  barge-in timing, code-switch detection, and noise robustness.
- **Latency regression** — per-stage budgets asserted in CI; a regression fails the
  build.
- **Safety red-team** — adversarial prompts attempting to extract diagnosis or
  prescription. Zero tolerance.

---

## 11. Risks and honest limitations

| Risk | Mitigation |
|---|---|
| Local LLM tool-calling reliability under Hinglish | Constrained decoding + schema retry; cloud tier is the sold configuration |
| Local TTS (Piper) quality is noticeably below ElevenLabs | Positioned as the free dev/offline tier; phrase cache means demos still hear the premium voice |
| Whisper transcribes Hindi to Devanagari while the LLM may reason better in Latin | Dual-form normalisation in the language layer |
| Telephony audio is 8 kHz — materially harder for STT | Twilio adapter upsamples; endpointing thresholds tuned separately per channel |
| Compliance claims | Architected toward HIPAA/DPDP; not certified. Stated plainly, never oversold. |
| Scope | Phased, each phase independently runnable |

---

## 12. Credentials

| Key | Needed for | Without it |
|---|---|---|
| `ELEVENLABS_API_KEY` | premium TTS, phrase cache build | Piper local TTS; cache ships empty |
| `GEMINI_API_KEY` | cloud LLM + embeddings | Ollama + local embeddings |
| `DEEPGRAM_API_KEY` / `SARVAM_API_KEY` | cloud STT | whisper.cpp local |
| `TWILIO_*` | PSTN calls | browser + WhatsApp only |
| `WHATSAPP_*` | WhatsApp channel | browser + PSTN only |

**The system runs fully offline with zero keys.** Every key upgrades a component; none
is required to boot. That is the point of the tier architecture.
