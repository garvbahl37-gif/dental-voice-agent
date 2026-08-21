'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import '../landing.css'

/**
 * Sign in.
 *
 * One job, so one column and nothing else on the page. The error is whatever
 * the server said, verbatim — it is deliberately the same message for a wrong
 * password and an unknown address, and rewording it here would undo that.
 */
export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not sign in.')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lp" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <form onSubmit={submit} style={S.card}>
        <div style={{ marginBottom: 26 }}>
          <div className="lp-mark-sub" style={{ marginBottom: 8 }}>VAANI</div>
          <h1 style={S.title}>Sign in</h1>
          <p style={S.sub}>The front desk, and what it did while you were with a patient.</p>
        </div>

        <label style={S.label} htmlFor="email">Email</label>
        <input
          id="email" type="email" required autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} style={S.input} placeholder="you@practice.in"
        />

        <label style={S.label} htmlFor="password">Password</label>
        <input
          id="password" type="password" required autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} style={S.input}
        />

        {error && <p role="alert" style={S.error}>{error}</p>}

        <button className="lp-btn lp-btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  card: {
    width: 'min(400px, 92vw)', background: 'var(--surface)', border: '1px solid var(--hairline)',
    borderRadius: 'var(--r-lg)', padding: 'clamp(26px, 5vw, 40px)', boxShadow: 'var(--shadow-lg)',
  },
  title: { fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 8px' },
  sub: { fontSize: 14, color: 'var(--ink-muted)', margin: 0, lineHeight: 1.5 },
  label: { display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6, marginTop: 16 },
  input: {
    width: '100%', font: 'inherit', fontSize: 15, padding: '11px 13px',
    border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-md)',
    background: 'var(--bg)', color: 'var(--ink)',
  },
  error: {
    marginTop: 16, marginBottom: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--alert)',
    background: 'var(--alert-soft)', border: '1px solid rgba(179,53,42,0.24)',
    borderRadius: 'var(--r-md)', padding: '10px 13px',
  },
}
