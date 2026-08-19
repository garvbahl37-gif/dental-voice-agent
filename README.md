# Vaani — AI front desk for dental practices

A multilingual voice agent that answers the phone for a dental practice. It speaks
English, Hindi, and — the case that actually matters in India — **Hinglish**, the
code-switched register most callers use.

It books, reschedules and cancels against real chair availability, answers questions
from a grounded knowledge base, triages dental emergencies to a safe escalation path,
and hands off to a human when it should.

The agent has no persona name. Asked who it is, it says it is the practice's automated
receptionist and carries on — it never claims to be a person.

![The landing page](docs/screenshots/landing.png)

---

## The console

Press **Take a call** and talk. Interrupt it mid-sentence; it stops, and it does not
remember saying what you never heard.

![A call in progress](docs/screenshots/console-call.png)

Left: live state, mouth-to-ear latency, and the transcript with each speaker in their own
hue. Right: what the agent has understood so far — caller identity, anything committed to
the diary, and every tool call with its latency.

When the line drops, the practice gets the record it actually needs — not a transcript,
but an answer to *"is there anything for me to do about this call?"*

![The call summary](docs/screenshots/console-summary.png)

**Needs a human** is the field that matters. An unidentified caller, an unconfirmed
number, an escalated emergency, a call that ended without booking — each is surfaced
rather than buried. Empty is the good outcome.

---

## Run it

```bash
pnpm install
cp .env.example .env          # set GEMINI_API_KEY

./scripts/dev.sh              # console :3000, voice server :8787
```

Open <http://localhost:3000>, then <http://localhost:3000/console> to take a call.

```bash
pnpm test                     # 405 tests
pnpm tsx scripts/e2e-call.ts  # drives a real call with synthesised caller speech
node scripts/browser-audit.mjs # real browser, fake mic, asserts behaviour §-by-§
```

---

## How it works

**Gemini Live, native audio.** Speech goes in and speech comes out of one model —
there is no separate STT, LLM and TTS. This is the whole architectural bet, and it is
the reason it does not sound like an agent.

A cascaded pipeline structurally cannot sound human: the synthesiser never learns what
the sentence *meant*, so it guesses prosody from text alone. It will read a genuine
question with the falling pitch of a statement, put the stress on the wrong word in
"*Thursday* works, or Friday?", and flatten every hesitation the caller uses to judge
whether they are being understood. Native audio carries intent from comprehension
straight through to articulation.

The model also owns turn-taking. Its VAD decides when the caller has started and
stopped, so barge-in is immediate and automatic — there is no interrupt button, because
a receptionist does not have one.

**Language is followed, not configured.** Detection is per turn. When the caller
switches to Hindi the agent switches with them and *stays* switched, and the accent
follows — `speechConfig.languageCode` is repinned and the session reconnects on its
resumption handle at a turn boundary, so it is never cut mid-sentence. Same voice
throughout; a voice that changes identity mid-call breaks the illusion instantly.

**Clinical safety is three layers, and the last one has no bypass.** Prompt rails,
`triage_symptoms` owning every urgency decision, and a post-generation guard sitting
between the agent and the transport. A blocked utterance is replaced before a single
sample is synthesised. Diagnosis, prescription, prognosis and guarantees are hard-blocked
— in all three languages, including when the same question comes back rephrased.

**Emergency triage is rules, not a model.** An avulsed tooth has roughly a 30-minute
re-implantation window. That decision is hard-coded, because a model that is right 97% of
the time is wrong about someone's tooth once every thirty-three calls.

**Pronunciation is measured, not assumed.** Doctor names, Mumbai place names and clinical
terms carry explicit stress marks (`Iyer [EYE-yer]`, `Deshpande [desh-PAAN-day]`,
`Bandra [BAAN-dra]`) fed to the model as custom vocabulary. Scored by round-trip —
synthesise, transcribe, compare — which moved it from 79% to 86%.

---

## Layout

```
packages/
  shared/      wire protocol (zod), audio format, latency budgets, PII redaction
  live/        Gemini Live session — config, reconnection, accent switching
  agent/       practice data, slot solver, 13 tools, knowledge, triage, safety, CRM
  core/        Transport interface (+ the earlier cascaded pipeline, see below)
  providers/   STT/LLM/TTS adapters used by the cascaded pipeline
apps/
  voice-server/  WebSocket bridge: browser ⟷ Gemini Live, with tools and guards
  web/           Next.js — landing page at /, console at /console
```

`packages/core` and `packages/providers` hold the original cascaded implementation —
turn manager, adaptive endpointing, barge-in truncation, sentence chunker, hallucination
filter, phrase cache. It is still tested and still works, but it is **not** on the live
path; the voice server uses `@vaani/live`. It is kept because the `Transport` interface
it defines is what telephony will plug into, and because the truncation and endpointing
work is worth not throwing away.

Design and plan documents live in [docs/superpowers/](docs/superpowers/).

---

## Seeded practice

Smile Dental Care — 3 branches (Bandra West, Andheri West, Powai), 6 dentists with
qualifications and specialties, 12 treatments indexed by the names patients actually use
(*safai* → scaling, *akal daadh* → wisdom tooth, cap → crown, RCT → root canal).

Every slot the agent offers is read from the diary at the moment it speaks.

---

## Mobile

![The landing page on mobile](docs/screenshots/landing-mobile.png)

---

## Not built yet

The Twilio and WhatsApp adapters — the `Transport` interface exists for them, and the
conversation, diary and knowledge are transport-agnostic, so each is an adapter rather
than a second pipeline. Also outbound campaigns (reminders, recall, waitlist auto-fill),
call recording and playback, and the analytics dashboard.

Compliance posture is *architected toward* HIPAA / India DPDP — consent logging, PII
redaction, audit trail — but it is not certified, and that claim is not made.
