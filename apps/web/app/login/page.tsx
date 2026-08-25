'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import '../landing.css'
import '../dashboard/dashboard.css'
import './auth.css'

/**
 * Signing in, and signing up, on one page.
 *
 * Someone arriving here either has an account or wants one, and making the
 * second group hunt for a different page is a needless way to lose them. Both
 * live in one card with a segmented control between them, so the answer to
 * "where do I start?" is always "here".
 *
 * Creating an account creates a whole practice — that is what an account *is*
 * in this product. The form asks for the four things the tenant cannot be built
 * without and lets `/api/onboard` default the rest; the longer setup, with
 * branches and a website import, stays at `/start` and is linked rather than
 * duplicated.
 */

type Mode = 'in' | 'new'

export default function Login() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('in')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [practiceName, setPracticeName] = useState('')
  const [ownerName, setOwnerName] = useState('')

  function go(next: Mode) {
    setMode(next)
    // The previous mode's error does not apply to this one.
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const url = mode === 'in' ? '/api/auth' : '/api/onboard'
    const payload =
      mode === 'in' ? { email, password } : { practiceName, ownerName, email, password }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        // Verbatim from the server. Sign-in deliberately gives the same message
        // for a wrong password and an unknown address, and rewording it here
        // would undo that.
        setError(body.error ?? 'That did not work. Try again.')
        return
      }
      // Both routes set the session cookie, so both land in the same place.
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const creating = mode === 'new'

  return (
    <div className="lp au-shell">
      <form onSubmit={submit} className="au-card">
        <a className="au-mark" href="/">
          <span className="au-mark-dot" aria-hidden />
          Vaani
        </a>

        <div className="au-switch" role="tablist" aria-label="Sign in or create an account">
          <span className={`au-switch-pill${creating ? ' is-right' : ''}`} aria-hidden />
          <button
            type="button"
            role="tab"
            aria-selected={!creating}
            className={`au-switch-tab${!creating ? ' is-on' : ''}`}
            onClick={() => go('in')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={creating}
            className={`au-switch-tab${creating ? ' is-on' : ''}`}
            onClick={() => go('new')}
          >
            Create account
          </button>
        </div>

        <h1 className="au-title">{creating ? 'Set up your practice' : 'Sign in'}</h1>
        <p className="au-sub">
          {creating
            ? 'One practice, ready to take calls. You can add branches, dentists and fees once you are in.'
            : 'The front desk, and what it did while you were with a patient.'}
        </p>

        {creating && (
          <>
            <label className="au-label" htmlFor="practice">
              Practice name
            </label>
            <input
              id="practice"
              className="kb-input"
              required
              minLength={3}
              autoComplete="off"
              value={practiceName}
              onChange={(e) => setPracticeName(e.target.value)}
              placeholder="Smile Dental Care"
            />

            <label className="au-label" htmlFor="owner">
              Your name
            </label>
            <input
              id="owner"
              className="kb-input"
              required
              autoComplete="name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Dr. Ananya Sharma"
            />
          </>
        )}

        <label className="au-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="kb-input"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@practice.in"
        />

        <label className="au-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="kb-input"
          type="password"
          required
          minLength={creating ? 8 : undefined}
          /* A password manager must be told which of the two this is, or it
             offers to fill a new account with an existing password. */
          autoComplete={creating ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {creating && <p className="au-hint">At least 8 characters.</p>}

        {error && (
          <p role="alert" className="au-error">
            {error}
          </p>
        )}

        <button className="lp-btn lp-btn-primary au-go" disabled={busy}>
          {busy
            ? creating
              ? 'Setting up…'
              : 'Signing in…'
            : creating
              ? 'Create practice'
              : 'Sign in'}
        </button>

        <p className="au-foot">
          {creating ? (
            <>
              Want to import your website and add branches as you go?{' '}
              <a href="/start">Use the longer setup</a>.
            </>
          ) : (
            <>
              No account yet?{' '}
              <button type="button" className="au-link" onClick={() => go('new')}>
                Create one
              </button>
              .
            </>
          )}
        </p>
      </form>
    </div>
  )
}
