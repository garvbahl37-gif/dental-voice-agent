'use client'

/**
 * The practice panel — what the front desk would be watching.
 *
 * Set as CareFlow's column of cards: the caller on sage where CareFlow shows
 * a reading, the bookings and lookups on white, an emergency in coral at the
 * top. Everything here updates from `ui.event` as the call happens: the
 * patient card fills as details are extracted, the booking lands the instant
 * it commits, lookups appear as they fire. That simultaneity is the point. A
 * transcript alone shows a conversation; this shows a system running.
 *
 * Nothing is shown until there is something to show. Three boxes reading
 * "Not identified yet", "Nothing booked yet" and "Idle" were most of what
 * anyone saw of this panel; one card says what will appear, and each section
 * arrives with its first content.
 */

export interface ToolActivity {
  id: string
  name: string
  args: Record<string, unknown>
  ms?: number
  ok?: boolean
}

export interface PatientCard {
  name?: string
  phone?: string
  preferredLanguage?: string
  upcoming?: number
  isNew?: boolean
}

export interface BookedAppointment {
  id: string
  patientName?: string
  serviceName?: string
  providerName?: string
  when?: string
}

interface Props {
  patient: PatientCard | null
  bookings: BookedAppointment[]
  tools: ToolActivity[]
  triage: { band: string; reason: string } | null
}

const TOOL: Record<string, string> = {
  lookup_patient: 'Looked up the caller',
  create_patient: 'Created a patient record',
  list_services: 'Read the treatment list',
  check_availability: 'Checked the diary',
  book_appointment: 'Booked the appointment',
  list_my_appointments: 'Found their appointments',
  reschedule_appointment: 'Moved the appointment',
  cancel_appointment: 'Cancelled the appointment',
  join_waitlist: 'Added to the waitlist',
  search_knowledge: 'Checked what the practice says',
  triage_symptoms: 'Triaged the symptoms',
  escalate_to_human: 'Flagged it for a person',
  record_note: 'Left a note',
}

export function PracticePanel({ patient, bookings, tools, triage }: Props) {
  const empty = !triage && !patient && bookings.length === 0 && tools.length === 0

  return (
    <aside className={`cc-side${empty ? ' is-empty' : ''}`} aria-label="What the desk understands">
      {empty && (
        <section className="cc-intro">
          <h2>What the desk understands</h2>
          <p>
            Who is calling, what goes in the diary and every lookup it makes appear here as the
            call happens — and in the conversation, where they were said.
          </p>
          <ul>
            <li>
              <i aria-hidden /> The caller, once identified
            </li>
            <li>
              <i aria-hidden /> Anything booked, the moment it commits
            </li>
            <li>
              <i aria-hidden /> Each lookup, with how long it took
            </li>
          </ul>
        </section>
      )}

      {triage && (
        <section className={`cc-triage is-${triage.band}`} role="alert">
          <header>
            <span className="cc-tile is-coral" aria-hidden>
              !
            </span>
            {triage.band === 'red' ? 'Emergency — clinic alerted' : 'Urgent — flagged for the doctor'}
          </header>
          <p>{triage.reason}</p>
        </section>
      )}

      {patient && (
        <section className="cc-caller">
          <header>
            <span className="cc-tile" aria-hidden>
              <PersonIcon />
            </span>
            Caller
            {patient.isNew && <span className="cc-pill">new</span>}
          </header>
          <p className="cc-caller-name">{patient.name ?? 'Collecting…'}</p>
          <dl>
            <Field label="Mobile" value={patient.phone} />
            <Field label="Speaks" value={patient.preferredLanguage} />
            <Field
              label="Upcoming"
              value={
                patient.upcoming === undefined
                  ? undefined
                  : patient.upcoming === 0
                    ? 'none'
                    : `${patient.upcoming} booked`
              }
            />
          </dl>
        </section>
      )}

      {bookings.length > 0 && (
        <section className="cc-card-w">
          <header>
            <h2>Booked this call</h2>
            <span className="cc-count">{bookings.length}</span>
          </header>
          <ul className="cc-bookings">
            {bookings.map((b) => (
              <li key={b.id}>
                <span className="cc-check" aria-hidden>
                  ✓
                </span>
                <span>
                  <strong>{b.serviceName}</strong>
                  <small>
                    {b.when}
                    {b.providerName ? ` · ${b.providerName}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tools.length > 0 && (
        <section className="cc-card-w">
          <header>
            <h2>Lookups</h2>
            <span className="cc-count is-grey">{tools.length}</span>
          </header>
          <ul className="cc-tools">
            {tools
              .slice(-6)
              .reverse()
              .map((t) => (
                <li key={t.id} className={t.ok === false ? 'is-bad' : undefined}>
                  <span className="cc-tool-name">{TOOL[t.name] ?? t.name.replace(/_/g, ' ')}</span>
                  <span className={`cc-pill${t.ms === undefined ? ' is-busy' : ''}`}>
                    {t.ms === undefined ? 'running' : `${Math.round(t.ms)} ms`}
                  </span>
                  {Object.keys(t.args).length > 0 && (
                    <small className="mono">
                      {Object.entries(t.args)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join('  ')}
                    </small>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? undefined : 'is-empty'}>{value ?? '—'}</dd>
    </div>
  )
}

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c1.2-3.6 3.8-5.4 7-5.4s5.8 1.8 7 5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
