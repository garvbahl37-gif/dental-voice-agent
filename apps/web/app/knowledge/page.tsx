'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppBar } from '../app-bar'
import { LoadingScreen } from '../loading-screen'
import { ListSkeleton } from '../dashboard/skeleton'
import { RulesFlow } from './flow'
import '../landing.css'
import '../dashboard/dashboard.css'
import '../dashboard/careflow.css'
import './knowledge.css'

/**
 * What the agent is allowed to say about this practice.
 *
 * Two halves, in the order an owner needs to trust them. First the rules it
 * will not bend — the emergency path and the refusals — drawn as the path a
 * call takes, because those are what a practice is actually worried about
 * when it puts something on the phone. Then the practice's own words it may
 * quote: each source shows what it is, where it came from, and how much of it
 * was usable, and removing one says plainly that the agent will stop using it.
 *
 * Importing a website is the primary path, because the fee list already exists
 * there and nobody is going to retype it.
 */

interface Doc {
  id: string
  title: string
  sourceType: string
  sourceRef: string | null
  status: 'pending' | 'indexed' | 'failed'
  chunkCount: number
  error: string | null
  createdAt: string
}

export default function Knowledge() {
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'site' | 'text' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  /** The list could not be read; the loading screen lifts and says so. */
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/knowledge').catch(() => null)
    if (res?.status === 401) return router.push('/login')
    if (!res?.ok) {
      setFailed(true)
      return
    }
    setFailed(false)
    setDocs(((await res.json()) as { documents: Doc[] }).documents)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  async function send(payload: Record<string, string>, which: 'site' | 'text') {
    setBusy(which)
    setMessage(null)
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json()) as { error?: string; imported?: number; chunks?: number }
      if (!res.ok) {
        setMessage({ kind: 'bad', text: body.error ?? 'The import failed.' })
        return
      }
      setMessage({
        kind: 'ok',
        text: `Imported ${body.imported} ${body.imported === 1 ? 'source' : 'pages'} — ${body.chunks} passages the agent can now quote.`,
      })
      setUrl('')
      setText('')
      setTitle('')
      await load()
    } catch {
      setMessage({ kind: 'bad', text: 'Could not reach the server.' })
    } finally {
      setBusy(null)
    }
  }

  async function forget(doc: Doc) {
    await fetch(`/api/knowledge?id=${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="lp db-shell">
      <LoadingScreen label="Opening knowledge" done={docs !== null || failed} />
      <AppBar />

      <header className="db-head">
        <div>
          <h1 className="db-title">What it may say</h1>
          <p className="db-sub">
            The rules it follows on every call, and the practice&rsquo;s own words it is allowed to
            quote.
          </p>
        </div>
      </header>

      <section className="db-section">
        <h2 className="db-h2">The rules it will not bend</h2>
        <RulesFlow />
      </section>

      <section className="db-section">
        <h2 className="db-h2">What it can quote</h2>
        <div className="kb-add">
          <form
            className="kb-source"
            onSubmit={(e) => {
              e.preventDefault()
              void send({ url }, 'site')
            }}
          >
            <span className="kb-source-icon" aria-hidden>
              ◎
            </span>
            <h3 className="kb-source-title">Import your website</h3>
            <p className="kb-source-desc">
              Vaani reads your services, fees, opening hours and FAQs, and answers from those pages
              only. It skips blog posts and images.
            </p>
            <div className="kb-row">
              <input
                className="kb-input"
                type="url"
                required
                autoComplete="url"
                placeholder="https://your-practice.in"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Practice website address"
              />
              <button className="lp-btn lp-btn-primary" disabled={busy !== null}>
                {busy === 'site' ? 'Reading the site…' : 'Import'}
              </button>
            </div>
          </form>

          <form
            className="kb-source"
            onSubmit={(e) => {
              e.preventDefault()
              void send({ title, text }, 'text')
            }}
          >
            <span className="kb-source-icon" aria-hidden>
              ¶
            </span>
            <h3 className="kb-source-title">Or paste something</h3>
            <input
              className="kb-input"
              placeholder="What is this? e.g. Insurance policy"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
            />
            <textarea
              className="kb-input kb-textarea"
              rows={4}
              required
              placeholder="Paste a fee list, a policy, or anything patients ask about…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Text to import"
            />
            <button className="lp-btn lp-btn-ghost kb-add-btn" disabled={busy !== null}>
              {busy === 'text' ? 'Saving…' : 'Add this'}
            </button>
          </form>
        </div>

        {message && (
          <p
            role="status"
            className={`db-empty ${message.kind === 'ok' ? 'db-good' : 'kb-bad'}`}
            style={{ marginTop: 14 }}
          >
            {message.text}
          </p>
        )}
      </section>

      <section className="db-section">
        <h2 className="db-h2">
          Sources
          {docs && docs.length > 0 && <span className="db-count kb-count">{docs.length}</span>}
        </h2>
        {!docs && failed ? (
          <p className="db-empty kb-bad" role="alert">
            Could not load the sources. Refresh to try again.
          </p>
        ) : !docs ? (
          <ListSkeleton />
        ) : docs.length === 0 ? (
          <p className="db-empty">
            Nothing imported yet. Until you add something, the agent answers from the practice
            details it was set up with, and says it does not know the rest.
          </p>
        ) : (
          <ul className="db-list kb-docs">
            {docs.map((d) => (
              <li key={d.id} className="kb-doc">
                <span className="kb-doc-icon" aria-hidden>
                  {d.sourceType === 'url' || d.sourceType === 'website' ? '◎' : '¶'}
                </span>
                <div className="kb-doc-body">
                  <strong className="kb-doc-title">{d.title}</strong>
                  {d.sourceRef && <span className="kb-ref">{d.sourceRef}</span>}
                  {d.error && <span className="kb-ref kb-bad-text">{d.error}</span>}
                </div>
                <div className="kb-doc-meta">
                  {d.status === 'indexed' ? (
                    <span className="db-tag db-tag-booked">{d.chunkCount} passages</span>
                  ) : (
                    <span className={`db-tag${d.status === 'failed' ? ' db-tag-alert' : ''}`}>{d.status}</span>
                  )}
                  <span className="kb-doc-date">{new Date(d.createdAt).toLocaleDateString('en-IN')}</span>
                </div>
                <button className="kb-forget" onClick={() => void forget(d)}>
                  Remove — the agent stops using this
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
