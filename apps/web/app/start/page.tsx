'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import '../landing.css'
import '../dashboard/dashboard.css'

/**
 * Setting up a practice.
 *
 * Three steps, and only the first is required to have a working account. That
 * ordering is the whole design: a long form asking for every dentist and every
 * fee before anything works is a form nobody finishes, and the agent can answer
 * the phone knowing only the practice name and one location.
 *
 * The website import is offered last and framed as optional, because it is the
 * step most likely to fail and the one whose failure matters least.
 */

type Step = 'practice' | 'account' | 'website'

export default function Start() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('practice')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [practiceName, setPracticeName] = useState('')
  const [area, setArea] = useState('')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [website, setWebsite] = useState('')

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ practiceName, area, city, phone, ownerName, email, password, website }),
      })
      const body = (await res.json()) as { error?: string; importError?: string }
      if (!res.ok) {
        setError(body.error ?? 'Could not create the practice.')
        // Send them back to the step that owns the problem.
        if (res.status === 409) setStep('practice')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lp ob-shell">
      <div className="ob-card">
        <div className="ob-steps" aria-label="Progress">
          {(['practice', 'account', 'website'] as Step[]).map((s, i) => (
            <span key={s} className={`ob-step${step === s ? ' is-on' : ''}`}>
              {i + 1}
            </span>
          ))}
        </div>

        {step === 'practice' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('account')
            }}
          >
            <h1 className="ob-title">Your practice</h1>
            <p className="ob-sub">
              Enough to answer the phone. You can add dentists, chairs and fees once you are in.
            </p>

            <label className="ob-label" htmlFor="name">Practice name</label>
            <input id="name" className="kb-input" required value={practiceName} minLength={3}
              autoComplete="off" onChange={(e) => setPracticeName(e.target.value)}
              placeholder="Smile Dental Care" />

            <div className="ob-row">
              <div>
                <label className="ob-label" htmlFor="area">Area</label>
                <input id="area" className="kb-input" value={area}
                  autoComplete="off" onChange={(e) => setArea(e.target.value)}
                  placeholder="Bandra West" />
              </div>
              <div>
                <label className="ob-label" htmlFor="city">City</label>
                <input id="city" className="kb-input" value={city}
                  autoComplete="off" onChange={(e) => setCity(e.target.value)}
                  placeholder="Mumbai" />
              </div>
            </div>

            <label className="ob-label" htmlFor="phone">Practice phone</label>
            <input id="phone" className="kb-input" value={phone} inputMode="tel" type="tel"
              autoComplete="off" onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 22 2655 1200" />
            <p className="ob-hint">
              Used as the number the agent gives out, and where urgent calls are sent.
            </p>

            {error && <p role="alert" className="db-empty kb-bad ob-error">{error}</p>}
            <button className="lp-btn lp-btn-primary ob-next">Continue</button>
          </form>
        )}

        {step === 'account' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('website')
            }}
          >
            <h1 className="ob-title">Your login</h1>
            <p className="ob-sub">This is how you will see what the agent did while you were with a patient.</p>

            <label className="ob-label" htmlFor="owner">Your name</label>
            <input id="owner" className="kb-input" required value={ownerName}
              autoComplete="name" onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Dr. Ananya Sharma" />

            <label className="ob-label" htmlFor="email">Email</label>
            <input id="email" className="kb-input" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@practice.in" />

            <label className="ob-label" htmlFor="password">Password</label>
            <input id="password" className="kb-input" type="password" required minLength={8}
              autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
            <p className="ob-hint">At least 8 characters.</p>

            {error && <p role="alert" className="db-empty kb-bad ob-error">{error}</p>}
            <div className="ob-actions">
              <button type="button" className="lp-btn lp-btn-ghost" onClick={() => setStep('practice')}>
                Back
              </button>
              <button className="lp-btn lp-btn-primary">Continue</button>
            </div>
          </form>
        )}

        {step === 'website' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <h1 className="ob-title">Your website</h1>
            <p className="ob-sub">
              Optional. Vaani reads your services, fees and opening hours so it can answer
              questions from your own words rather than guessing. You can do this later.
            </p>

            <label className="ob-label" htmlFor="site">Website address</label>
            <input id="site" className="kb-input" type="url" value={website}
              autoComplete="url" onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://your-practice.in" />
            <p className="ob-hint">It skips blog posts and images, and you can remove anything it picks up.</p>

            {error && <p role="alert" className="db-empty kb-bad ob-error">{error}</p>}
            <div className="ob-actions">
              <button type="button" className="lp-btn lp-btn-ghost" onClick={() => setStep('account')} disabled={busy}>
                Back
              </button>
              <button className="lp-btn lp-btn-primary" disabled={busy}>
                {busy ? (website ? 'Reading your site…' : 'Setting up…') : 'Finish'}
              </button>
            </div>
            {/* Says plainly that skipping costs nothing, so nobody stalls here. */}
            <button
              type="button"
              className="ob-skip"
              disabled={busy}
              onClick={() => {
                setWebsite('')
                void submit()
              }}
            >
              Skip — set this up later
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
