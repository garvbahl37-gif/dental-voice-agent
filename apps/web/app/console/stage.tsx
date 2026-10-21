'use client'

import type { AgentState, Lang } from '@vaani/shared'
import { ALL_LANGS, LANG_ENGLISH, LANG_LABEL, htmlLang } from '@vaani/shared'
import { VoiceBlob } from '@/components/VoiceBlob'

/**
 * The call, on stage.
 *
 * The two references together: CareFlow's large dark card, where its video
 * call plays, and standing in the middle of it Momo's glass call card — the
 * orb, the name, a timer that runs while the line is open, the voice trace,
 * and one round button that answers in green and hangs up in red.
 *
 * Around the card, where CareFlow puts the caller's name and its controls: who
 * this desk is top left, what it is doing top right, the language bottom left,
 * and the live measurements inset bottom right — real numbers, not
 * confidence theatre.
 */

interface Props {
  agentState: AgentState
  live: boolean
  /** Opening the line: the server waking, or the socket connecting. */
  busy: 'waking' | 'connecting' | null
  levels: { mic: number; agent: number }
  spectrum: (t: 'mic' | 'agent') => Uint8Array
  elapsed: number
  lang: Lang
  onLang: (l: Lang) => void
  onStart: () => void
  onEnd: () => void
  /** Mouth to ear for the last turn, and whether it met the budget. */
  e2e: { ms: number; good: boolean } | null
  turns: number
  model?: string | null
  /** A call is on screen: the stage gives the conversation more room. */
  compact: boolean
}

export function Stage({
  agentState,
  live,
  busy,
  levels,
  spectrum,
  elapsed,
  lang,
  onLang,
  onStart,
  onEnd,
  e2e,
  turns,
  model,
  compact,
}: Props) {
  const talking = live && (agentState === 'speaking' || agentState === 'listening')

  return (
    <section className={`cc-stage${live ? ' is-live' : ''}${compact ? ' is-compact' : ''}`} aria-label="The call">
      <div className="cc-scene" aria-hidden />

      <header className="cc-stage-head">
        <h1>Front desk</h1>
        <p>Smile Dental Care · Bandra, Andheri, Powai</p>
      </header>

      <span className={`cc-state is-${live ? agentState : 'idle'}`} aria-live="polite">
        <i aria-hidden />
        {live ? stateLabel(agentState) : busy === 'waking' ? 'Waking' : busy === 'connecting' ? 'Connecting' : 'Ready'}
      </span>

      <div className="cc-card">
        <div className="cc-orb">
          <VoiceBlob
            state={agentState}
            micLevel={levels.mic}
            agentLevel={levels.agent}
            spectrum={spectrum}
            live={live}
          />
        </div>
        <p className="cc-card-title">Vaani front desk</p>
        <p className={`cc-card-sub${live ? ' mono' : ''}`}>
          {live
            ? clock(elapsed)
            : busy === 'waking'
              ? 'Waking the server…'
              : busy === 'connecting'
                ? 'Connecting…'
                : 'In any of eleven languages'}
        </p>
        <Trace active={talking} who={agentState === 'listening' ? 'caller' : 'desk'} />
        {live ? (
          // No interrupt button. Interrupting is what talking over someone
          // *is* — the VAD hears you and she stops. A button would be an
          // admission that it does not work on its own.
          <button className="cc-call is-end" onClick={onEnd} aria-label="End call">
            <PhoneIcon />
          </button>
        ) : (
          <button className="cc-call is-answer" onClick={onStart} disabled={busy !== null} aria-label="Take a call">
            <PhoneIcon />
          </button>
        )}
        <span className="cc-call-k">{live ? 'End call' : busy ? 'Opening the line' : 'Take a call'}</span>
      </div>

      {/*
        Named in each language's own script, because nobody scans a list of
        English names looking for their language — a Tamil speaker finds
        தமிழ், not "Tamil".

        Choosing mid-call is allowed: the accent lives in a connect-time
        setting, so the server reconnects on its resumption handle at the next
        turn boundary rather than cutting anyone off. Choosing before the call
        simply opens the session in that language.
      */}
      <label className="cc-lang">
        <span className="sr-only">Language</span>
        <GlobeIcon />
        <select value={lang} onChange={(e) => onLang(e.target.value as Lang)} lang={htmlLang(lang)}>
          {ALL_LANGS.map((l) => (
            <option key={l} value={l} lang={htmlLang(l)}>
              {LANG_LABEL[l]}
              {LANG_LABEL[l] === LANG_ENGLISH[l] ? '' : ` · ${LANG_ENGLISH[l]}`}
            </option>
          ))}
        </select>
      </label>

      <dl className="cc-pip">
        <div>
          <dt>Mouth to ear</dt>
          <dd className={e2e ? (e2e.good ? 'is-good' : 'is-slow') : undefined}>
            {e2e ? `${Math.round(e2e.ms)}` : '—'}
            {e2e && <small>ms</small>}
          </dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{turns}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{live ? clock(elapsed) : '—'}</dd>
        </div>
        {model && <p className="cc-pip-foot mono">{model}</p>}
      </dl>
    </section>
  )
}

/** The voice trace under the timer: still between calls, moving with a voice. */
function Trace({ active, who }: { active: boolean; who: 'caller' | 'desk' }) {
  return (
    <svg className={`cc-trace${active ? ' is-on' : ''} is-${who}`} viewBox="0 0 120 30" aria-hidden>
      {[0, 1, 2, 3].map((k) => (
        <path
          key={k}
          className={`v${k}`}
          d={`M0 15 ${Array.from({ length: 25 }, (_, i) => {
            const env = Math.sin((i / 24) * Math.PI)
            return `L${i * 5} ${(15 + Math.sin(i * 0.9 + k * 1.3) * 11 * env).toFixed(1)}`
          }).join(' ')}`}
        />
      ))}
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5C9.6 18.1 8.4 15.3 8.4 12S9.6 5.9 12 3.5z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function stateLabel(state: AgentState): string {
  return {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    tool_running: 'Checking diary',
  }[state]
}

export function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
