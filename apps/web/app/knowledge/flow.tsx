'use client'

import { useState } from 'react'

/**
 * The rules the desk cannot be talked out of, drawn as the path a call takes.
 *
 * After Atlas (Halo Design Studio): call steps as nodes on a light canvas, and
 * a side panel that says what each step is for, how it behaves, and the rules
 * it follows, in plain language. An owner reading a form of settings has to
 * imagine the call; reading this, they can follow one — "swelling with fever"
 * lights the path from the symptom to the red band to the callback.
 *
 * Nothing here is a setting. The bands, their triggers and the words said are
 * transcribed from `packages/agent/src/triage.ts` and the clinical guard in
 * `safety.ts`; if those change, this has to change with them.
 */

type Tone = 'caller' | 'desk' | 'red' | 'amber' | 'green' | 'human'
type Band = 'red' | 'amber' | 'green'

interface Step {
  id: string
  title: string
  desc: string
  tone: Tone
  chips?: string[]
  purpose: string
  outcome?: string
  behaviour: Array<{ k: string; v: string; lang?: string; quote?: boolean }>
  rules: Array<{ k: string; v: string[] }>
}

// ── Emergencies ──────────────────────────────────────────────────────────────

const START: Step = {
  id: 'start',
  title: 'Caller describes a symptom',
  desc: 'In any of the eleven languages, in their own words.',
  tone: 'caller',
  purpose:
    'Somebody rings about a mouth that hurts, bleeds or has swollen. The desk does not ask them to pick a category or press a number; it listens for the symptom in whatever way it is said.',
  outcome: 'Symptoms are reported to triage, word for word',
  behaviour: [
    { k: 'What the desk does', v: 'Stops whatever it was doing — a booking included — and hands what was said to triage.' },
  ],
  rules: [{ k: 'Heard in', v: ['English, Hindi, Hinglish and eight more', 'Mid-sentence switches between them'] }],
}

const TRIAGE: Step = {
  id: 'triage',
  title: 'Triage',
  desc: 'Fixed rules decide the band. The model only reports what was said.',
  tone: 'desk',
  chips: ['3 bands', '7 rules'],
  purpose:
    'Decide how urgent this is, without asking a language model to judge it. A knocked-out tooth has about thirty minutes; a model that answers that conversationally has done harm, so urgency is decided by rules written in advance.',
  outcome: 'One band — red, amber or green — and the exact words to say',
  behaviour: [
    { k: 'Checked in order', v: 'The first rule that matches wins, which is why bleeding gums are checked before bleeding: the common, chronic case must not be read as a haemorrhage.' },
  ],
  rules: [
    { k: 'Red', v: ['Airway or spreading infection', 'A knocked-out tooth', 'Bleeding happening now', 'Facial trauma'] },
    { k: 'Amber', v: ['Bleeding gums', 'Severe pain or abscess', 'A broken tooth or lost filling'] },
    { k: 'Green', v: ['Everything else'] },
  ],
}

const BANDS: Record<Band, Step> = {
  red: {
    id: 'red',
    title: 'Red — emergency',
    desc: 'Minutes matter, and a dental chair is the wrong place.',
    tone: 'red',
    chips: ['First in the queue', 'Now'],
    purpose:
      'Get the caller to emergency care at once, and put the call first in the practice’s queue.',
    outcome: 'Emergency room advised; first in “Needs a human”',
    behaviour: [
      {
        k: 'Says, word for word',
        v: 'I need to stop you there — what you are describing needs urgent medical attention, and it should not wait for a dental appointment. Please go to your nearest emergency room right away. I am alerting the clinic now, and our on-call dentist will call you within a few minutes.',
        quote: true,
      },
      {
        k: 'In Hinglish',
        v: 'Main aapko yahin rokungi — jo aap bata rahe hain usme turant medical attention chahiye, yeh appointment ka wait nahi kar sakta. Please abhi nazdeeki emergency room jaiye. Main clinic ko alert kar rahi hoon, hamare on-call doctor kuch hi minute mein aapko call karenge.',
        lang: 'hi-Latn',
        quote: true,
      },
    ],
    rules: [
      {
        k: 'Airway or spreading infection',
        v: [
          'Difficulty breathing or swallowing',
          'Cannot open the mouth',
          'Swelling near the eye, throat, neck or jaw',
          'A swollen face, or fever with swelling',
        ],
      },
      { k: 'Knocked-out tooth — about 30 minutes', v: ['Knocked out, or came out completely', '“पूरा दाँत निकल गया”', 'A broken tooth is amber, not this'] },
      { k: 'Bleeding happening now', v: ['Bleeding that will not stop', '“खून आ रहा है”, said plainly', 'Gums that bleed when brushed are amber'] },
      { k: 'Facial trauma', v: ['A broken jaw', 'An accident to the mouth, jaw or teeth'] },
    ],
  },
  amber: {
    id: 'amber',
    title: 'Amber — urgent',
    desc: 'Needs seeing soon: same day to three days.',
    tone: 'amber',
    chips: ['1–3 days'],
    purpose: 'Get the caller seen quickly without treating them as an emergency.',
    outcome: 'The earliest slot inside the window',
    behaviour: [
      {
        k: 'Says',
        v: 'That sounds painful, and I do not want you waiting on it. Let me find you the earliest slot we have — I will also flag this for the doctor so they know before you arrive.',
        quote: true,
      },
    ],
    rules: [
      { k: 'Severe pain or probable abscess — next day', v: ['Severe or unbearable pain', 'Cannot sleep for the pain', 'Pus, an abscess, a swollen gum', '“Bahut dard hai”'] },
      { k: 'Broken tooth or lost restoration — two days', v: ['A broken, chipped or cracked tooth', 'A crown or filling that came out', '“दाँत टूट गया”'] },
      { k: 'Bleeding gums — three days', v: ['Gums that bleed when brushed', 'Likely gingivitis, not acute'] },
    ],
  },
  green: {
    id: 'green',
    title: 'Green — routine',
    desc: 'Anything that is not urgent.',
    tone: 'green',
    chips: ['Within 14 days'],
    purpose: 'Book the caller in at a time that suits them.',
    outcome: 'An ordinary appointment',
    behaviour: [{ k: 'Says', v: 'Understood. Let me find a time that works for you.', quote: true }],
    rules: [{ k: 'Matches', v: ['Nothing in red or amber'] }],
  },
}

const ACTIONS: Record<Band, Step[]> = {
  red: [
    {
      id: 'red-stop',
      title: 'Booking stops',
      desc: 'No routine slot is offered. The words are not softened.',
      tone: 'red',
      purpose: 'Keep a caller in danger from being talked into an appointment next week.',
      behaviour: [
        { k: 'Instruction the desk is given', v: 'Say it verbatim. Do not soften it, do not add to it, do not offer a routine appointment.' },
      ],
      rules: [{ k: 'Applies', v: ['Mid-sentence, if a booking was under way'] }],
    },
    {
      id: 'red-alert',
      title: 'First in the queue',
      desc: 'A high-priority task is raised while the caller is still on the line.',
      tone: 'red',
      chips: ['High priority'],
      purpose: 'Put it where the team looks first — not wait for someone to read a transcript.',
      // What the code does, not what the spoken script promises: nothing is
      // sent to anyone; the row is on the dashboard at its next refresh.
      outcome: 'In “Needs a human” at high priority — no message is sent',
      behaviour: [{ k: 'Raised as', v: '“RED triage” with the reason, flagged high.' }],
      rules: [{ k: 'Every red band', v: ['Raises it — there is no red without the queue entry'] }],
    },
    {
      id: 'red-human',
      title: 'Call this patient now',
      desc: 'Top of “Needs a human” on the dashboard, emergencies first.',
      tone: 'human',
      purpose: 'Put the callback in front of whoever opens the dashboard next.',
      outcome: 'The Next callback card, with the number one tap away',
      behaviour: [{ k: 'On the dashboard', v: 'Ranked emergency first, then newest — an emergency is never the ninth item down.' }],
      rules: [{ k: 'Stays until', v: ['Somebody marks it handled'] }],
    },
  ],
  amber: [
    {
      id: 'amber-slot',
      title: 'Earliest slot',
      desc: 'Searched inside the window the rule sets.',
      tone: 'amber',
      chips: ['1–3 days'],
      purpose: 'Find the soonest real opening rather than the next convenient one.',
      behaviour: [{ k: 'Then', v: 'Offers at most two times, read back in the caller’s own language.' }],
      rules: [{ k: 'Window', v: ['Pain or abscess: next day', 'Broken tooth: two days', 'Bleeding gums: three days'] }],
    },
  ],
  green: [
    {
      id: 'green-book',
      title: 'Routine booking',
      desc: 'The diary is checked before any time is offered.',
      tone: 'green',
      chips: ['14 days'],
      purpose: 'An ordinary appointment, booked while the caller is on the line.',
      behaviour: [{ k: 'Then', v: 'Confirms it, and says a WhatsApp confirmation is on its way.' }],
      rules: [{ k: 'Before booking', v: ['The slot is re-checked at the moment it is written'] }],
    },
  ],
}

const EXAMPLES: Array<{ id: string; label: string; said: string; lang?: string; band: Band }> = [
  { id: 'swelling', label: 'Swelling with fever', said: 'My face is swollen and I have a fever', band: 'red' },
  { id: 'knocked', label: 'Knocked-out tooth', said: 'My son’s tooth got knocked out at football', band: 'red' },
  { id: 'bleeding', label: 'Bleeding won’t stop', said: 'खून बंद नहीं हो रहा', lang: 'hi', band: 'red' },
  { id: 'pain', label: 'Pain, can’t sleep', said: 'Bahut dard hai, so nahi paa raha', lang: 'hi-Latn', band: 'amber' },
  { id: 'broken', label: 'Chipped tooth', said: 'I chipped my tooth on a bone', band: 'amber' },
  { id: 'gums', label: 'Gums bleed', said: 'My gums bleed when I brush', band: 'amber' },
  { id: 'clean', label: 'A cleaning', said: 'I’d like to book a cleaning', band: 'green' },
]

// ── What it won't do ─────────────────────────────────────────────────────────

/**
 * The five things the desk declines, each with the push a caller makes and
 * the reply it gets — the reply never ends on the refusal, it ends on an offer.
 */
interface Refusal {
  id: string
  /** The struck word, and what follows it. */
  verb: string
  rest: string
  /** What a caller actually says to push on this rule. */
  ask: string
  askLang?: string
  /** What comes back. */
  reply: string
  /** The line under the exchange — why the rule exists. */
  because: string
}

const REFUSALS: Refusal[] = [
  {
    id: 'diagnose',
    verb: 'Diagnose',
    rest: 'anything',
    ask: 'Is this a cavity or just sensitivity?',
    reply:
      'I can’t tell you that — it needs someone to look at it. Dr. Mehta has 11:30 on Thursday at Andheri. Shall I hold it?',
    because: 'It does not speculate about a mouth it cannot see.',
  },
  {
    id: 'prescribe',
    verb: 'Prescribe',
    rest: 'or advise on medicine',
    ask: 'Koi painkiller bata do na, bahut dard ho raha hai.',
    askLang: 'hi-Latn',
    reply:
      'Main dawai nahi bata sakti. Par aaj hi dikha sakte hain — ya agar wait nahi kar sakta, toh emergency line de deti hoon.',
    because:
      'Not for a patient who insists, and not in Hindi when the same question comes back rephrased.',
  },
  {
    id: 'price',
    verb: 'Invent',
    rest: 'a price',
    ask: 'Roughly what does a root canal come to?',
    reply:
      'That one isn’t on the list I have, so I won’t guess at it. Dr. Nair’s office can call you back with the figure today.',
    because: 'A quoted number a patient repeats at the counter is worse than no number at all.',
  },
  {
    id: 'availability',
    verb: 'Guess',
    rest: 'at availability',
    ask: 'Saturday morning is free, right?',
    reply:
      'Let me check rather than tell you wrong… Saturday’s full at Bandra. There’s 11:30 at Andheri, or Monday evening here.',
    because: 'It would rather take a beat than fill silence with a slot that turns out to be taken.',
  },
  {
    id: 'person',
    verb: 'Pretend',
    rest: 'to be a person',
    ask: 'Wait — am I talking to a real person?',
    reply:
      'No, I’m the practice’s assistant. I can put you through to reception if you’d rather speak to someone.',
    because: 'It has no name and does not perform one.',
  },
]


const PUSH: Step = {
  id: 'push',
  title: 'Caller pushes',
  desc: 'Asks for something a receptionist must not give.',
  tone: 'caller',
  purpose: 'People ask a front desk for diagnoses, painkillers and prices all the time. The desk has to decline without leaving them with nothing.',
  behaviour: [{ k: 'Never ends on the refusal', v: 'Every decline is followed by what it can do instead.' }],
  rules: [{ k: 'Holds when', v: ['The caller insists', 'The same question comes back rephrased, or in another language'] }],
}

const GUARD: Step = {
  id: 'guard',
  title: 'Clinical guard',
  desc: 'Every reply is checked after it is written and before it is spoken.',
  tone: 'desk',
  chips: ['Every reply'],
  purpose:
    'Instructions to a model can be talked around. This cannot: it reads each reply after it is generated and before it becomes audio, so a violation never reaches the caller even if the prompt was subverted.',
  behaviour: [{ k: 'Catches', v: 'A diagnosis, a drug name, a prognosis, or a guarantee about treatment.' }],
  rules: [{ k: 'Layers', v: ['Instructions to the model', 'Triage owning every urgency decision', 'This check, last, on every reply'] }],
}

const ENFORCED: Record<string, string[]> = {
  diagnose: ['The guard blocks telling a caller what condition they have, in English and Hindi'],
  prescribe: ['The guard blocks naming any drug, however the sentence is phrased'],
  price: ['Prices come only from the practice’s own list and the sources below', 'Nothing found means “I don’t know” and a callback, not an estimate'],
  availability: ['The diary is checked before any time is offered — every time', 'The slot is checked again at the moment of booking'],
  person: ['It has no name and does not take one', 'Asked, it says it is the practice’s assistant and offers reception'],
}

const REFUSAL_STEPS: Step[] = REFUSALS.map((r) => ({
  id: `no-${r.id}`,
  title: `${r.verb} ${r.rest}`,
  desc: r.because,
  tone: 'desk',
  purpose: r.because,
  behaviour: [
    { k: 'Caller', v: r.ask, lang: r.askLang },
    { k: 'Front desk', v: r.reply, lang: r.askLang, quote: true },
  ],
  rules: [{ k: 'Enforced by', v: ENFORCED[r.id] ?? [] }],
}))

// ─────────────────────────────────────────────────────────────────────────────

const ALL: Step[] = [
  START,
  TRIAGE,
  ...Object.values(BANDS),
  ...Object.values(ACTIONS).flat(),
  PUSH,
  GUARD,
  ...REFUSAL_STEPS,
]

const bandOf = (id: string): Band | null =>
  (['red', 'amber', 'green'] as const).find((b) => id === b || id.startsWith(`${b}-`)) ?? null

export function RulesFlow() {
  const [view, setView] = useState<'triage' | 'guard'>('triage')
  const [example, setExample] = useState<string | null>('swelling')
  const [band, setBand] = useState<Band>('red')
  const [selected, setSelected] = useState('red')

  const step = ALL.find((s) => s.id === selected) ?? TRIAGE
  // The path the chosen example takes: everything else steps back.
  const path = example ? new Set(['start', 'triage', band, ...ACTIONS[band].map((a) => a.id)]) : null

  const pick = (id: string) => {
    setSelected(id)
    const b = bandOf(id)
    if (b) setBand(b)
  }

  return (
    <div className="kf">
      <div className="kf-canvas">
        <div className="kf-views" role="tablist" aria-label="Which rules">
          {(
            [
              ['triage', 'Emergencies'],
              ['guard', 'What it won’t do'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`kf-view${view === v ? ' is-on' : ''}`}
              onClick={() => {
                setView(v)
                setSelected(v === 'triage' ? band : 'guard')
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'triage' ? (
          <>
            <div className="kf-said" role="group" aria-label="Try what a caller says">
              <span className="kf-said-k">A caller says</span>
              {EXAMPLES.map((e) => (
                <button
                  key={e.id}
                  className={`kf-ex is-${e.band}${example === e.id ? ' is-on' : ''}`}
                  aria-pressed={example === e.id}
                  onClick={() => {
                    setExample(e.id)
                    setBand(e.band)
                    setSelected(e.band)
                  }}
                >
                  {e.label}
                </button>
              ))}
            </div>
            {example && (
              <p className="kf-quote" lang={EXAMPLES.find((e) => e.id === example)?.lang}>
                “{EXAMPLES.find((e) => e.id === example)?.said}”
              </p>
            )}

            {/* The path is keyed on the example so it lights up again, step by
                step, every time a different caller is chosen. */}
            <div className="kf-tree" key={example ?? 'none'}>
              <Node step={START} on={selected} path={path} i={0} pick={pick} />
              <Node step={TRIAGE} on={selected} path={path} i={1} pick={pick} />

              {/* On a phone, three columns are three slivers; one branch at a
                  time, chosen here, reads instead. */}
              <div className="kf-bandpick" role="group" aria-label="Band">
                {(['red', 'amber', 'green'] as const).map((b) => (
                  <button
                    key={b}
                    className={`kf-bandbtn is-${b}${band === b ? ' is-on' : ''}`}
                    aria-pressed={band === b}
                    onClick={() => {
                      setBand(b)
                      setSelected(b)
                      setExample(null)
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>

              <div className="kf-branches">
                {(['red', 'amber', 'green'] as const).map((b) => (
                  <div key={b} className={`kf-branch is-${b}${band === b ? ' is-shown' : ''}`}>
                    <Node step={BANDS[b]} on={selected} path={path} i={2} pick={pick} />
                    {ACTIONS[b].map((a, j) => (
                      <Node key={a.id} step={a} on={selected} path={path} i={3 + j} pick={pick} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="kf-tree">
            <Node step={PUSH} on={selected} path={null} i={0} pick={pick} />
            <Node step={GUARD} on={selected} path={null} i={1} pick={pick} />
            <div className="kf-grid">
              {REFUSAL_STEPS.map((s, j) => (
                <Node key={s.id} step={s} on={selected} path={null} i={2 + j} pick={pick} />
              ))}
            </div>
          </div>
        )}
      </div>

      <Panel step={step} />
    </div>
  )
}

function Node({
  step,
  on,
  path,
  i,
  pick,
}: {
  step: Step
  on: string
  path: Set<string> | null
  i: number
  pick: (id: string) => void
}) {
  const lit = path?.has(step.id)
  return (
    <button
      type="button"
      className={`kf-node is-${step.tone}${on === step.id ? ' is-on' : ''}${path ? (lit ? ' is-lit' : ' is-dim') : ''}`}
      style={{ ['--i' as string]: i }}
      aria-pressed={on === step.id}
      onClick={() => pick(step.id)}
    >
      <span className="kf-node-top">
        <span className="kf-icon" aria-hidden>
          {ICON[step.tone]}
        </span>
        <span className="kf-node-title">{step.title}</span>
      </span>
      <span className="kf-node-desc">{step.desc}</span>
      {step.chips && (
        <span className="kf-node-chips">
          {step.chips.map((c) => (
            <span key={c} className="kf-chip">
              {c}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

/** Purpose, behaviour and rules — in that order, because that is the order an owner asks. */
function Panel({ step }: { step: Step }) {
  const [tab, setTab] = useState<'purpose' | 'behaviour' | 'rules'>('purpose')

  return (
    <aside className="kf-panel" aria-live="polite">
      <div className="kf-panel-head">
        <span className={`kf-icon is-${step.tone}`} aria-hidden>
          {ICON[step.tone]}
        </span>
        <h3 className="kf-panel-title">{step.title}</h3>
      </div>

      <div className="kf-tabs" role="tablist" aria-label="About this step">
        {(['purpose', 'behaviour', 'rules'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`kf-tab${tab === t ? ' is-on' : ''}`}
            onClick={() => setTab(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="kf-tabpanel" role="tabpanel" key={`${step.id}-${tab}`}>
        {tab === 'purpose' && (
          <>
            <span className="kf-field-k">What this step is responsible for</span>
            <p className="kf-box">{step.purpose}</p>
            {step.outcome && (
              <>
                <span className="kf-field-k">Outcome</span>
                <p className={`kf-box kf-outcome is-${step.tone}`}>{step.outcome}</p>
              </>
            )}
          </>
        )}
        {tab === 'behaviour' &&
          step.behaviour.map((b) => (
            <div key={b.k}>
              <span className="kf-field-k">{b.k}</span>
              <p className={`kf-box${b.quote ? ' kf-said-box' : ''}`} lang={b.lang}>
                {b.v}
              </p>
            </div>
          ))}
        {tab === 'rules' &&
          step.rules.map((r) => (
            <div key={r.k}>
              <span className="kf-field-k">{r.k}</span>
              <ul className="kf-rules">
                {r.v.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      <p className="kf-fixed">
        Fixed in code, not a setting. These rules hold whatever the agent is told on the settings
        page.
      </p>
    </aside>
  )
}

const ICON: Record<Tone, string> = {
  caller: '☏',
  desk: '◆',
  red: '!',
  amber: '◷',
  green: '✓',
  human: '☎',
}
