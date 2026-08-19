'use client'

/**
 * The practice panel — what the front desk would be watching.
 *
 * Everything here updates from `ui.event` as the call happens: the patient card
 * fills field by field as details are extracted, the booking lands in the
 * calendar the instant it commits, tool calls appear as they fire. That
 * simultaneity is the point. A transcript alone shows a conversation; this
 * shows a system running.
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

export function PracticePanel({ patient, bookings, tools, triage }: Props) {
  return (
    <aside style={styles.panel}>
      {triage && <TriageBanner band={triage.band} reason={triage.reason} />}

      <Section title="caller">
        {patient ? (
          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span style={styles.patientName}>{patient.name ?? 'Collecting…'}</span>
              {patient.isNew && <span style={styles.newChip}>new</span>}
            </div>
            <Field label="mobile" value={patient.phone} />
            <Field label="speaks" value={patient.preferredLanguage} />
            <Field
              label="upcoming"
              value={
                patient.upcoming === undefined
                  ? undefined
                  : patient.upcoming === 0
                    ? 'none'
                    : `${patient.upcoming} booked`
              }
            />
          </div>
        ) : (
          <Placeholder>Not identified yet</Placeholder>
        )}
      </Section>

      <Section title="booked this call">
        {bookings.length === 0 ? (
          <Placeholder>Nothing booked yet</Placeholder>
        ) : (
          <div style={styles.stack}>
            {bookings.map((b) => (
              <div key={b.id} style={styles.booking}>
                <div style={styles.bookingHead}>
                  <span style={styles.service}>{b.serviceName}</span>
                  <span style={styles.tick}>✓</span>
                </div>
                <span style={styles.when}>{b.when}</span>
                <span style={styles.doctor}>{b.providerName}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="tools">
        {tools.length === 0 ? (
          <Placeholder>Idle</Placeholder>
        ) : (
          <div style={styles.stack}>
            {tools.slice(-6).reverse().map((t) => (
              <div key={t.id} style={styles.tool}>
                <div style={styles.toolHead}>
                  <span className="mono" style={styles.toolName}>
                    {t.name}
                  </span>
                  {t.ms !== undefined && (
                    <span className="mono" style={styles.toolMs}>
                      {Math.round(t.ms)}ms
                    </span>
                  )}
                </div>
                {Object.keys(t.args).length > 0 && (
                  <span className="mono" style={styles.toolArgs}>
                    {Object.entries(t.args)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join('  ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </aside>
  )
}

function TriageBanner({ band, reason }: { band: string; reason: string }) {
  const red = band === 'red'
  return (
    <div
      role="alert"
      style={{
        ...styles.triage,
        borderColor: red ? 'var(--alert)' : 'var(--agent)',
        background: red ? 'rgba(255,92,77,0.08)' : 'rgba(255,180,67,0.07)',
      }}
    >
      <span
        className="label"
        style={{ color: red ? 'var(--alert)' : 'var(--agent)', letterSpacing: '0.16em' }}
      >
        {red ? 'emergency — escalated' : 'urgent'}
      </span>
      <span style={styles.triageReason}>{reason}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={styles.section}>
      <span className="label">{title}</span>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div style={styles.field}>
      <span className="label" style={{ fontSize: 9 }}>
        {label}
      </span>
      <span
        className="mono"
        style={{ fontSize: 12, color: value ? 'var(--ink)' : 'var(--ink-faint)' }}
      >
        {value ?? '—'}
      </span>
    </div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <div style={styles.placeholder}>{children}</div>
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 330,
    flexShrink: 0,
    borderLeft: '1px solid var(--hairline)',
    background: 'var(--bg-tint)',
    padding: '30px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 26,
    overflowY: 'auto',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--r-lg)',
    background: 'var(--surface)',
    padding: 16,
    boxShadow: 'var(--shadow-sm)',
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
  },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  patientName: { fontFamily: 'var(--font-display)', fontSize: 19 },
  newChip: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--caller)',
    border: '1px solid var(--caller-line)',
    background: 'var(--caller-soft)',
    borderRadius: 3,
    padding: '1px 5px',
  },
  field: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  stack: { display: 'flex', flexDirection: 'column', gap: 8 },
  booking: {
    border: '1px solid var(--hairline)',
    borderLeft: '2px solid var(--confirm)',
    borderRadius: 'var(--r-md)',
    background: 'var(--surface)',
    padding: '12px 14px',
    boxShadow: 'var(--shadow-sm)',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    animation: 'none',
  },
  bookingHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  service: { fontSize: 13, fontWeight: 500 },
  tick: { color: 'var(--confirm)', fontSize: 12 },
  when: { fontSize: 12, color: 'var(--ink-muted)' },
  doctor: { fontSize: 11, color: 'var(--ink-faint)' },
  tool: {
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--r-sm)',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  toolHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  toolName: { fontSize: 11, color: 'var(--caller)', fontWeight: 500 },
  toolMs: { fontSize: 10, color: 'var(--ink-faint)' },
  toolArgs: { fontSize: 10, color: 'var(--ink-faint)', wordBreak: 'break-word' },
  placeholder: { fontSize: 12, color: 'var(--ink-faint)', padding: '10px 0' },
  triage: {
    border: '1px solid',
    borderRadius: 'var(--r-md)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  triageReason: { fontSize: 12.5, lineHeight: 1.45 },
}
