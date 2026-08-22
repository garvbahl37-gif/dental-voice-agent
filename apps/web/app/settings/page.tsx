'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import '../landing.css'
import '../dashboard/dashboard.css'

/**
 * Keys, webhooks and branding.
 *
 * The one interaction worth designing carefully is issuing a key. It is shown
 * exactly once, so the interface says so *before* the key appears and keeps it
 * on screen until it is dismissed deliberately — a secret that vanishes on the
 * next render is a support ticket.
 */

interface Payload {
  branding: {
    brandName: string | null
    brandColor: string | null
    brandLogoUrl: string | null
    agentPersona: string | null
  }
  keys: Array<{
    id: string
    name: string
    prefix: string
    scope: string
    lastUsedAt: string | null
    revokedAt: string | null
  }>
  webhooks: Array<{
    id: string
    url: string
    events: string[]
    failures: number
    disabledAt: string | null
  }>
}

const EVENTS = [
  ['call.completed', 'A call finished'],
  ['appointment.booked', 'An appointment was booked'],
  ['appointment.cancelled', 'An appointment was cancelled'],
  ['escalation.raised', 'Something needs a human'],
] as const

export default function Settings() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [secret, setSecret] = useState<{ label: string; value: string; note: string } | null>(null)
  const [keyName, setKeyName] = useState('')
  const [keyScope, setKeyScope] = useState<'read' | 'write'>('read')
  const [hookUrl, setHookUrl] = useState('')
  const [hookEvents, setHookEvents] = useState<string[]>(['call.completed'])
  const [brandName, setBrandName] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [persona, setPersona] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings')
    if (res.status === 401) return router.push('/login')
    if (res.status === 403) {
      setError('Settings need admin access.')
      return
    }
    if (!res.ok) return
    const body = (await res.json()) as Payload
    setData(body)
    setBrandName(body.branding.brandName ?? '')
    setBrandColor(body.branding.brandColor ?? '')
    setPersona(body.branding.agentPersona ?? '')
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  async function act(payload: Record<string, unknown>) {
    setError(null)
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json()) as Record<string, never> & { error?: string; notice?: string }
    if (!res.ok) {
      setError(body.error ?? 'That did not work.')
      return null
    }
    await load()
    return body
  }

  if (error && !data) {
    return (
      <div className="lp db-shell">
        <p className="db-empty kb-bad" role="alert">{error}</p>
      </div>
    )
  }

  return (
    <div className="lp db-shell">
      <header className="db-head">
        <div>
          <div className="lp-mark-sub">Settings</div>
          <h1 className="db-title">Keys and connections</h1>
        </div>
        <div className="db-head-right">
          <a className="db-signout" href="/dashboard">Back to dashboard</a>
        </div>
      </header>

      {/* Shown once, and it says so. Dismissed deliberately, never on rerender. */}
      {secret && (
        <section className="db-section">
          <div className="st-secret" role="alert">
            <strong>{secret.label}</strong>
            <code className="st-secret-value">{secret.value}</code>
            <p className="st-secret-note">{secret.note}</p>
            <button className="lp-btn lp-btn-ghost lp-btn-sm" onClick={() => setSecret(null)}>
              I have copied it
            </button>
          </div>
        </section>
      )}

      {error && <p className="db-empty kb-bad" role="alert" style={{ marginTop: 20 }}>{error}</p>}

      <section className="db-section">
        <h2 className="db-h2">API keys</h2>
        <p className="db-empty" style={{ marginBottom: 16 }}>
          For your practice software to read calls and book appointments. A key is shown once when
          it is created — we only ever store a hash of it.
        </p>

        <form
          className="kb-row"
          onSubmit={async (e) => {
            e.preventDefault()
            const out = await act({ action: 'issue_key', name: keyName, scope: keyScope })
            if (out?.key) {
              setSecret({
                label: 'Your new API key',
                value: (out.key as unknown as { secret: string }).secret,
                note: (out.notice as unknown as string) ?? '',
              })
              setKeyName('')
            }
          }}
        >
          <input className="kb-input" required autoComplete="off" placeholder="What is it for? e.g. Dentrix sync"
            value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <select className="kb-input st-select" value={keyScope}
            onChange={(e) => setKeyScope(e.target.value as 'read' | 'write')} aria-label="Access level">
            <option value="read">Read only</option>
            <option value="write">Read and book</option>
          </select>
          <button className="lp-btn lp-btn-primary">Create key</button>
        </form>

        {data && data.keys.length > 0 && (
          <ul className="db-queue" style={{ marginTop: 16 }}>
            {data.keys.map((k) => (
              <li key={k.id} className="db-brief">
                <div className="db-brief-head">
                  <strong>{k.name}</strong>
                  <span className="db-chip">{k.prefix}…</span>
                  <span className="db-chip">{k.scope === 'write' ? 'read + book' : 'read only'}</span>
                  {k.revokedAt && <span className="db-chip db-chip-alert">revoked</span>}
                  <span className="db-time">
                    {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString('en-IN')}` : 'never used'}
                  </span>
                </div>
                {!k.revokedAt && (
                  <button className="kb-forget" onClick={() => void act({ action: 'revoke_key', keyId: k.id })}>
                    Revoke — anything using this key stops working
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="db-section">
        <h2 className="db-h2">Webhooks</h2>
        <p className="db-empty" style={{ marginBottom: 16 }}>
          We POST to your endpoint when something happens, signed so you can verify it came from us.
          An endpoint that keeps failing is switched off and shown here.
        </p>

        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const out = await act({ action: 'add_webhook', url: hookUrl, events: hookEvents })
            if (out?.webhook) {
              setSecret({
                label: 'Signing secret',
                value: (out.webhook as unknown as { secret: string }).secret,
                note: (out.notice as unknown as string) ?? '',
              })
              setHookUrl('')
            }
          }}
        >
          <input className="kb-input" type="url" required autoComplete="url" placeholder="https://your-system.in/vaani"
            value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
          <div className="st-events">
            {EVENTS.map(([id, label]) => (
              <label key={id} className="st-check">
                <input type="checkbox" checked={hookEvents.includes(id)}
                  onChange={(e) =>
                    setHookEvents((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))
                  } />
                {label}
              </label>
            ))}
          </div>
          <button className="lp-btn lp-btn-ghost" style={{ marginTop: 12 }}>Add endpoint</button>
        </form>

        {data && data.webhooks.length > 0 && (
          <ul className="db-queue" style={{ marginTop: 16 }}>
            {data.webhooks.map((w) => (
              <li key={w.id} className="db-brief">
                <div className="db-brief-head">
                  <strong className="st-url">{w.url}</strong>
                  {w.disabledAt && <span className="db-chip db-chip-alert">switched off</span>}
                  {w.failures > 0 && !w.disabledAt && (
                    <span className="db-chip db-chip-alert">{w.failures} failed</span>
                  )}
                </div>
                <p className="kb-ref">{w.events.join(' · ')}</p>
                <button className="kb-forget" onClick={() => void act({ action: 'remove_webhook', hookId: w.id })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="db-section">
        <h2 className="db-h2">Branding and voice</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act({ action: 'branding', brandName, brandColor, agentPersona: persona })
          }}
        >
          <label className="ob-label" htmlFor="bn">Name shown in the dashboard</label>
          <input id="bn" className="kb-input" value={brandName} maxLength={60}
            onChange={(e) => setBrandName(e.target.value)} placeholder="Leave blank to use Vaani" />

          <label className="ob-label" htmlFor="bc">Accent colour</label>
          <input id="bc" className="kb-input" value={brandColor} placeholder="#b8730a"
            onChange={(e) => setBrandColor(e.target.value)} pattern="^#[0-9a-fA-F]{6}$" />
          <p className="ob-hint">Six-digit hex. Anything else is ignored.</p>

          <label className="ob-label" htmlFor="persona">How the agent should sound</label>
          <textarea id="persona" className="kb-input kb-textarea" rows={4} maxLength={2000}
            value={persona} onChange={(e) => setPersona(e.target.value)}
            placeholder="e.g. Warm but brisk. Always offer the Powai branch first." />
          <p className="ob-hint">
            Added to the agent&rsquo;s instructions. It cannot override the clinical rules — those
            are enforced after the words are generated, not asked for politely.
          </p>

          <button className="lp-btn lp-btn-primary" style={{ marginTop: 16 }}>Save</button>
        </form>
      </section>
    </div>
  )
}
