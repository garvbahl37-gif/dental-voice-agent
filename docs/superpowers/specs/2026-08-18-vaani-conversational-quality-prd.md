# Vaani — Conversational Quality PRD

**Product requirements** · 2026-08-18 · supersedes the behaviour spec for build purposes

---

## 1. Why this document exists

Vaani's plumbing works. Audio flows, barge-in truncates correctly, tools fire, appointments
book, latency sits near 1.4 s. And yet in a real call she is unusable:

> *"She forgets. I switch to Hindi in between and she still speaks in an English accent.
> She says 'waiting for a response'. She doesn't understand what context we're trying to
> say."*

Every one of those is a real defect with a located cause. This document is not a rewrite
of the architecture — the transport, turn-taking and provider layers are sound. It
re-specifies the layer above them: **what the agent knows, what it is told, and how it
speaks.**

### 1.1 Root causes, verified in code

| # | Symptom | Cause | Location |
|---|---|---|---|
| 1 | "She forgets" | `remember()` has one definition, twelve test call sites, and **zero production call sites**. `describeState()` therefore always returns "You have not learned anything about this caller yet." | `caller-state.ts` built, never wired |
| 2 | "Still speaks English after I switch" | The system prompt is pushed once in the constructor and never rebuilt. A mid-call language switch never reaches the model's instructions. | `session.ts:143` |
| 3 | English accent on Hindi | One voice (Bella, American) serves all three languages. No per-language mapping exists. | `.env` `ELEVENLABS_VOICE_ID` |
| 4 | "Waiting for a response" spoken | `stripStageDirections` removes bracketed notes only. Bare narration has no brackets to match. | `safety.ts` |

Causes 1 and 2 are the same architectural mistake wearing two hats: **the agent's
instructions are a snapshot taken before the conversation started.** Everything the agent
learns during a call — the caller's name, their language, what has been confirmed, what
has been offered — exists in the transcript but never in the instructions. The model is
asked to infer it, and reliably does not.

That is the thing this PRD fixes.

---

## 2. Goals

1. **She remembers.** Anything the caller says once is never asked for twice.
2. **She follows the caller's language, including the voice.** Switching to Hindi
   mid-sentence changes the language *and* the accent, within one turn.
3. **She never narrates.** No stage directions, no notes to self, no meta-commentary.
4. **She repairs naturally.** Corrections, mishearings and interruptions are handled the
   way a person handles them — briefly, without announcing the mechanism.
5. **Regressions are caught by machine, not by the user.** A scripted conversation suite
   replays multi-turn calls through the real pipeline.

### 2.1 Non-goals

- No change to transport, turn-taking, barge-in truncation, or the provider registry.
  Those work and are well tested.
- No telephony or WhatsApp in this phase.
- No persistence of call records across restarts. The CRM view stays in memory.

---

## 3. Conversation state — the core change

### 3.1 The principle

**The model is never asked to remember. It is told.**

A transcript is a poor memory. Facts stated twenty turns ago compete with everything
since, and the model's attention to them decays exactly when a long call needs them
most. So the agent maintains an explicit, typed record of the conversation, and that
record is rendered into the instructions on **every turn**.

### 3.2 What is tracked

```ts
interface ConversationState {
  // Identity
  caller: {
    name?: Fact<string>
    phone?: Fact<string>          // normalised to 10 digits
    patientId?: string
    isReturning: boolean
  }

  // Intent
  intent?: 'book' | 'reschedule' | 'cancel' | 'enquiry' | 'emergency' | 'unclear'
  service?: Fact<string>
  preferredTime?: Fact<string>
  preferredDoctor?: Fact<string>
  branch?: Fact<string>

  // Commitments — things the agent has said out loud
  offeredSlots: Slot[]            // never re-offer a slot already declined
  declinedSlots: string[]
  bookedAppointments: string[]
  questionsAsked: string[]        // never ask the same thing twice

  // Language
  language: Lang
  languageHistory: Lang[]         // detect thrash, settle on the dominant one

  // Repair
  lowConfidenceFields: string[]   // needs read-back before it can be used
  correctionCount: number         // repeated corrections signal a handoff
}

interface Fact<T> {
  value: T
  confirmed: boolean              // read back and agreed
  source: 'caller' | 'lookup'     // never re-confirm what the database supplied
  turnLearned: number
}
```

`questionsAsked` is the direct fix for the observed repetition. The agent cannot ask for
a name twice because the second attempt is visible in its own instructions as already
asked.

### 3.3 How it is written

State is written by **tool results and STT finals**, never by the model deciding to
update it. Two sources, both deterministic:

- `lookup_patient` / `create_patient` returning a record writes `caller.*` with
  `source: 'lookup'` and `confirmed: true` — the database is not something the caller
  needs to verify.
- A slot extractor runs on every caller final transcript and writes any name, phone,
  date, time or service it recognises, with `confirmed: false`.

The model never calls a "remember this" tool. Asking a model to maintain its own memory
reintroduces exactly the unreliability the state exists to remove.

### 3.4 How it is read

Rendered into the system message on every turn:

```
WHAT YOU ALREADY KNOW
  Caller: Rahul Verma (confirmed), 98765 43210 (NOT yet read back)
  Wants: scaling and polishing, Thursday morning preferred
  You have already asked for: name, mobile number
  You have offered: Monday 10:00 (declined), Monday 10:30
  Speaking: Hinglish

DO NOT ask again for anything listed above.
DO read back the mobile number before booking.
```

Explicit, short, regenerated per turn.

---

## 4. Live instruction assembly

### 4.1 The change

The system message becomes a **function of current state**, rebuilt before every model
call, replacing `history[0]` in place rather than being appended.

```
buildInstructions(state, practice, now) → string
```

Rebuilt because it contains: current language, known facts, questions already asked,
slots already offered, the current conversation phase, and time-of-day.

### 4.2 Cost

The instruction block is roughly 1,500 tokens and is rebuilt every turn. On Groq's free
tier this is a material part of the 8,000 TPM budget. Mitigations, in order:

1. Trim the static portion — the treatment catalogue does not belong in the prompt when
   `list_services` exists as a tool.
2. Cache the static prefix; only the state block varies.
3. Accept it and fix the LLM key situation (§9).

**Target: instructions under 900 tokens with the state block included.**

---

## 5. Language and voice

### 5.1 Detection and switching

Language is already detected per turn. Three changes:

1. **The instruction block states the current language explicitly**, so the model is told
   rather than left to infer. This alone fixes most of the observed failure.
2. **Hysteresis.** A single ambiguous turn must not flip the language. Switch only when
   two consecutive turns agree, or one turn is high-confidence and unambiguous
   (Devanagari script, or ≥ 3 Hindi function words). Prevents thrash on short turns like
   "yes" or "haan".
3. **The voice changes with the language, within the same turn.**

### 5.2 Voice mapping — OPEN DECISION

The requirement is a per-language provider mix. The blocker is that no Indian-voice
provider is currently confirmed:

| Option | Accent | Cost | Status |
|---|---|---|---|
| ElevenLabs premade (Bella) | American | free tier | works, wrong accent |
| ElevenLabs library (Rhea) | Indian | ~$5/mo | **402 on free tier** |
| Sarvam Bulbul | Indian | key available | **rejected on quality** — but only `anushka` was auditioned; `manisha`, `vidya`, `arya` were generated and never heard |
| Piper hi_IN | Indian | free, local | noticeably robotic |
| IndicF5 / XTTS fine-tune | Indian | free, self-hosted | unevaluated; needs a Python sidecar |

**Resolution plan, before this section is built:** synthesise the same three lines
(English, Hindi, Hinglish) through every remaining candidate, publish an audition page,
and pick by ear. If nothing is acceptable, the honest recommendation is the $5 ElevenLabs
tier — one voice, correct accent, no identity change.

**Constraint that survives whatever is chosen:** the voice must not change *within* a
language. A caller who hears two different Priyas in one call is worse off than one who
hears a consistent foreign accent.

---

## 6. Speech hygiene

Everything the model produces becomes audio. Three filters, applied in order, after
generation and before synthesis:

1. **Narration** — bracketed notes (already implemented) *and* bare narration:
   sentences whose subject is the agent's own process. `"Waiting for a response."`,
   `"I'll wait for their reply."`, `"Let me think about that."` when no tool is running.
   Detected by pattern against a list of narration verbs in first person or gerund form
   with no addressee.
2. **Formatting** — markdown, bullets, numbered lists, emoji, function-call markup
   (already implemented via `InlineToolExtractor`).
3. **Clinical safety** — unchanged, already implemented and tested.

A blocked utterance is **dropped, not replaced**, unless the turn would otherwise be
silent. Silence is better than a substitution the caller did not expect.

### 6.1 Speakability

Numbers, dates and times are rendered for the ear before synthesis: `4:30` → "four
thirty", `98765 43210` grouped as spoken, `₹1500` → "fifteen hundred rupees". Already
partially built in `caller-state.ts`; extended to dates and currency.

---

## 7. Repair and confirmation

### 7.1 Confirmation policy

Read back exactly once, and only what is both **critical and unconfirmed**:

| Field | Read back? |
|---|---|
| Phone captured from speech | yes, grouped |
| Name captured from speech | yes, if the booking depends on it |
| Appointment day and time | yes, before committing |
| Anything from `lookup_patient` | **no** — the database supplied it |
| Service, preference, branch | no |

`Fact.confirmed` makes this mechanical rather than a judgement the model makes each turn.

### 7.2 Mishearing

When STT confidence is low or the field fails validation (a phone number that is not ten
digits, a date in the past), ask about **the specific part only**:

> "Sorry, was that Thursday or Tuesday?"

Never "could you repeat that?" for a whole utterance when one field is in doubt.

### 7.3 Correction

A corrected value replaces the old one and clears confirmation. The acknowledgement is
one clause — "Thursday, got it" — never a description of the update.

`correctionCount ≥ 3` on the same field triggers a human handoff: repeated correction
means the agent is not hearing the caller, and continuing wastes their time.

---

## 8. Persona

Priya is a receptionist with six years at this practice. The measurable properties:

- **One or two sentences per turn.** Enforced by a token cap and a post-generation length
  check, not by asking politely in the prompt.
- **At most two options offered aloud**, never a list.
- **No service-industry filler**: "certainly", "absolutely", "of course", "I'd be happy
  to", "thank you for providing that information".
- **Contractions in English**, natural connectives in Hindi and Hinglish.
- **Never claims to be human**; never volunteers being an AI unless asked, then says it
  lightly and moves on.

---

## 9. Model and infrastructure

The current LLM situation is a live risk and belongs in this document:

- Groq free tier is **8,000 TPM**. A tool-using turn with 1,500 tokens of instructions
  exceeds it, and the turn fails.
- Gemini failover **cannot generate** — the supplied key is an OAuth-style token, and
  `gemini-2.5-flash` is retired for new keys.

**Requirement:** at least one LLM provider that can serve a full call without rate
limiting. Either a paid Groq tier, or a working `AIza…` Gemini key, or a local Ollama
model as the always-available floor. Instruction trimming (§4.2) reduces the pressure but
does not remove it.

---

## 10. Verification — scripted conversation suite

The reported defects all survived a passing test suite and a green browser audit, because
both tested single exchanges. Multi-turn behaviour was never tested.

### 10.1 What it does

Each scenario is a scripted multi-turn conversation replayed through the **real** pipeline
— real STT, real model, real TTS — with synthesised caller audio, asserting on final
state rather than on exact wording.

```
scenario: mid-call language switch
  caller (en): "Hi, I need a cleaning appointment"
  caller (hi): "कल सुबह का कोई slot है?"
  assert: language == hi-IN by turn 2
  assert: agent's turn-2 audio used the Hindi voice
  assert: no English sentence in turn 2
```

### 10.2 Scenarios

| Scenario | Asserts |
|---|---|
| Name given once | never asked again in 6 turns |
| Correction mid-call | final state holds the corrected value only |
| Language switch en → hi | language, voice, and reply language all follow within one turn |
| Language thrash | a single ambiguous turn does not flip the language |
| Interrupt mid-sentence | history contains only audible words; no resumption |
| Silence | nudge → check-in → close, each said once |
| Slot declined | never re-offered |
| Phone misheard | read back before booking |
| Emergency phrase | triage script verbatim, no routine booking offered |
| Repeated correction | handoff offered by the third |
| Tool failure | agent speaks; does not go silent |

### 10.3 What it does not assert

Exact wording. Asserting phrasing makes the suite brittle and pushes the agent toward
scripted speech, which is the defect we started with. It asserts **state, language,
voice, and the absence of prohibited output.**

---

## 11. Build order

Each phase ends with the suite green and is independently useful.

| Phase | Delivers | Fixes |
|---|---|---|
| **A. State** | `ConversationState`, slot extractor, written from tools and STT finals | "she forgets" |
| **B. Live instructions** | `buildInstructions()` rebuilt per turn, replacing `history[0]`; instruction trimming | "doesn't understand the context" |
| **C. Language** | Explicit language in instructions, hysteresis, per-language voice map | "still speaks English" |
| **D. Hygiene** | Bare-narration filter, speakability for dates and currency | "waiting for a response" |
| **E. Repair** | Confirmation policy, targeted clarification, correction handling, handoff triggers | naturalness |
| **F. Suite** | The eleven scenarios above, runnable in CI | regressions caught by machine |

Phase C is blocked on the voice decision in §5.2. Phases A, B, D can proceed immediately
and address three of the four reported defects.

---

## 12. Success criteria

Not "the tests pass" — the tests passed while the product was unusable. These are
observable in a real call:

1. A caller who gives their name once is never asked again.
2. Switching to Hindi mid-call changes the reply language *and* the voice within one turn.
3. No utterance in fifty consecutive calls contains narration, markup, or a stage
   direction.
4. A corrected fact appears only in its corrected form in the final call record.
5. A ten-turn call completes without a rate-limit failure.
6. The user can complete a booking end to end without needing to describe a bug.

Criterion 6 is the real bar. Everything above it is instrumentation.

---

## 13. Open decisions

1. **Indian voice provider** (§5.2) — blocked on an audition. Highest priority; blocks
   Phase C.
2. **LLM capacity** (§9) — paid Groq, working Gemini key, or local Ollama floor.
3. **Instruction budget** (§4.2) — how aggressively to trim before caching.

Nothing else in this document is uncertain.
