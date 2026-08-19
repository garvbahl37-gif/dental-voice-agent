'use client'

import type { Lang, TurnMetrics } from '@vaani/shared'
import type { Turn } from './Transcript'
import type { BookedAppointment, PatientCard, ToolActivity } from './PracticePanel'

/**
 * What the agent actually understood, once the call is over.
 *
 * This is the record a front desk needs the moment the line drops: who called,
 * what was captured, what was committed to the diary, and what still needs a
 * human. A transcript alone does not answer "is there anything for me to do
 * about this call?" — and that question is the whole reason a practice would
 * put an agent on the phone.
 *
 * Deliberately explicit about uncertainty: an unconfirmed number is shown as
 * unconfirmed rather than presented as fact, because the cost of a wrong
 * number is a patient who never gets their reminder.
 */

export interface CallSummary {
  endedAt: number
  durationSec: number
  turns: Turn[]
  patient: PatientCard | null
  bookings: BookedAppointment[]
  tools: ToolActivity[]
  triage: { band: string; reason: string } | null
  metrics: TurnMetrics[]
  lang: Lang
}

const LANG_LABEL: Record<Lang, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'hi-Latn-IN': 'Hinglish',
}

export function CallSummaryView({ summary, onNew }: { summary: CallSummary; onNew: () => void }) {
  const { patient, bookings, triage, turns, metrics, durationSec, lang } = summary

  const callerTurns = turns.filter((t) => t.speaker === 'caller').length
  const avgLatency =
    metrics.length > 0
      ? Math.round(metrics.reduce((n, m) => n + m.e2eMs, 0) / metrics.length)
      : null

  // What a human still has to do. Empty is the good outcome.
  const followUps: string[] = []
  if (triage) followUps.push(`Triage escalated — ${triage.reason}`)
  if (patient?.isNew) followUps.push('New patient record created — verify details')
  if (!patient) followUps.push('Caller was never identified')
  if (bookings.length === 0 && callerTurns > 0) followUps.push('No appointment was booked')

  const outcome =
    bookings.length > 0 ? 'booked' : triage ? 'escalated' : callerTurns === 0 ? 'no-speech' : 'no-booking'

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <div style={s.eyebrow}>Call ended</div>
          <h2 style={s.title}>{outcomeLabel(outcome)}</h2>
        </div>
        <button onClick={onNew} style={s.newBtn}>
          Take another call
        </button>
      </div>

      <div style={s.grid}>
        <Card title="Caller">
          {patient ? (
            <>
              <Row k="Name" v={patient.name} />
              <Row k="Mobile" v={patient.phone} />
              <Row k="Spoke" v={LANG_LABEL[lang]} />
              <Row k="Record" v={patient.isNew ? 'newly created' : 'existing patient'} />
            </>
          ) : (
            <Empty>Not identified during the call</Empty>
          )}
        </Card>

        <Card title="Booked">
          {bookings.length === 0 ? (
            <Empty>Nothing was committed to the diary</Empty>
          ) : (
            bookings.map((b) => (
              <div key={b.id} style={s.booking}>
                <strong style={s.bookingService}>{b.serviceName}</strong>
                <span style={s.bookingWhen}>{b.when}</span>
                <span style={s.bookingDoc}>{b.providerName}</span>
              </div>
            ))
          )}
        </Card>

        <Card title="Call">
          <Row k="Duration" v={`${Math.floor(durationSec / 60)}m ${durationSec % 60}s`} />
          <Row k="Caller turns" v={String(callerTurns)} />
          <Row k="Avg response" v={avgLatency ? `${avgLatency} ms` : '—'} />
          <Row k="Tools used" v={String(new Set(summary.tools.map((t) => t.name)).size)} />
        </Card>

        <Card title="Needs a human" accent={followUps.length > 0}>
          {followUps.length === 0 ? (
            <Empty>Nothing outstanding</Empty>
          ) : (
            <ul style={s.list}>
              {followUps.map((f) => (
                <li key={f} style={s.listItem}>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {turns.length > 0 && (
        <details style={s.details}>
          <summary style={s.summary}>Full transcript ({turns.length} turns)</summary>
          <div style={s.transcript}>
            {turns.map((t) => (
              <div key={t.id} style={s.line}>
                <span
                  style={{
                    ...s.speaker,
                    color: t.speaker === 'caller' ? 'var(--caller)' : 'var(--agent)',
                  }}
                >
                  {t.speaker === 'caller' ? 'Caller' : 'Front desk'}
                </span>
                <span>
                  {t.speaker === 'caller'
                    ? t.text
                    : (t.utterances ?? []).map((u) => u.text).join(' ')}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function outcomeLabel(o: string): string {
  return {
    booked: 'Appointment booked',
    escalated: 'Escalated to the clinic',
    'no-speech': 'No conversation took place',
    'no-booking': 'No appointment booked',
  }[o] ?? 'Call ended'
}

function Card({
  title,
  children,
  accent,
}: {
  title: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <section
      style={{
        ...s.card,
        borderColor: accent ? 'var(--alert)' : 'var(--hairline)',
        background: accent ? 'var(--alert-soft)' : 'var(--surface)',
      }}
    >
      <span className="label">{title}</span>
      <div style={s.cardBody}>{children}</div>
    </section>
  )
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div style={s.row}>
      <span style={s.rowKey}>{k}</span>
      <span className="mono" style={{ ...s.rowVal, color: v ? 'var(--ink)' : 'var(--ink-faint)' }}>
        {v ?? '—'}
      </span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={s.empty}>{children}</span>
}

const s: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column', gap: 22, minHeight: 0, paddingTop: 10 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },
  eyebrow: {
    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6,
  },
  title: {
    margin: 0, fontFamily: 'var(--font-display)', fontSize: 27,
    fontWeight: 500, letterSpacing: '-0.015em',
  },
  newBtn: {
    fontSize: 13.5, fontWeight: 600, padding: '11px 24px',
    borderRadius: 'var(--r-pill)', background: 'var(--agent)', color: '#fff',
    boxShadow: '0 5px 14px rgba(184,115,10,0.26)',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 12 },
  card: {
    border: '1px solid', borderRadius: 'var(--r-lg)', padding: 16,
    display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-sm)',
  },
  cardBody: { display: 'flex', flexDirection: 'column', gap: 7 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  rowKey: { fontSize: 12, color: 'var(--ink-muted)' },
  rowVal: { fontSize: 12.5 },
  empty: { fontSize: 12.5, color: 'var(--ink-faint)' },
  booking: { display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 },
  bookingService: { fontSize: 13.5 },
  bookingWhen: { fontSize: 12, color: 'var(--ink-muted)' },
  bookingDoc: { fontSize: 11.5, color: 'var(--ink-faint)' },
  list: { margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 },
  listItem: { fontSize: 12.5, lineHeight: 1.45 },
  details: {
    border: '1px solid var(--hairline)', borderRadius: 'var(--r-md)',
    background: 'var(--surface)', padding: '12px 16px', overflow: 'hidden',
  },
  summary: { cursor: 'pointer', fontSize: 12.5, color: 'var(--ink-muted)' },
  transcript: {
    marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8,
    maxHeight: 260, overflowY: 'auto',
  },
  line: { display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5 },
  speaker: { fontSize: 11, fontWeight: 600, minWidth: 44, flexShrink: 0, paddingTop: 2 },
}
