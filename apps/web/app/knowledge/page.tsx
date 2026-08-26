'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListSkeleton } from '../dashboard/skeleton'
import '../landing.css'
import '../dashboard/dashboard.css'

/**
 * What the agent is allowed to say about this practice.
 *
 * The framing is deliberate. This is not "upload files" — it is the set of
 * things the agent may quote as the clinic's own words, and a practice needs to
 * see it as exactly that. So each source shows what it is, where it came from,
 * and how much of it was usable, and removing one says plainly that the agent
 * will stop using it.
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

  const load = useCallback(async () => {
    const res = await fetch('/api/knowledge')
    if (res.status === 401) return router.push('/login')
    if (!res.ok) return
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
      <header className="db-head">
        <div>
          <div className="lp-mark-sub">Knowledge</div>
          <h1 className="db-title">What it may say</h1>
        </div>
        <div className="db-head-right">
          <a className="db-signout" href="/dashboard">
            Back to dashboard
          </a>
        </div>
      </header>

      <section className="db-section">
        <h2 className="db-h2">Import your website</h2>
        <p className="db-empty" style={{ marginBottom: 16 }}>
          Vaani reads your services, fees, opening hours and FAQs, and answers from those pages
          only. It skips blog posts and images. You can remove anything it picked up.
        </p>
        <form
          className="kb-row"
          onSubmit={(e) => {
            e.preventDefault()
            void send({ url }, 'site')
          }}
        >
          <input
            className="kb-input"
            type="url"
            required
            autoComplete="url" placeholder="https://your-practice.in"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Practice website address"
          />
          <button className="lp-btn lp-btn-primary" disabled={busy !== null}>
            {busy === 'site' ? 'Reading the site…' : 'Import'}
          </button>
        </form>
      </section>

      <section className="db-section">
        <h2 className="db-h2">Or paste something</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send({ title, text }, 'text')
          }}
        >
          <input
            className="kb-input"
            placeholder="What is this? e.g. Insurance policy"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Title"
            style={{ marginBottom: 10 }}
          />
          <textarea
            className="kb-input kb-textarea"
            rows={7}
            required
            placeholder="Paste a fee list, a policy, or anything patients ask about…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Text to import"
          />
          <button className="lp-btn lp-btn-ghost" disabled={busy !== null} style={{ marginTop: 12 }}>
            {busy === 'text' ? 'Saving…' : 'Add this'}
          </button>
        </form>
      </section>

      {message && (
        <p role="status" className={`db-empty ${message.kind === 'ok' ? 'db-good' : 'kb-bad'}`} style={{ marginTop: 20 }}>
          {message.text}
        </p>
      )}

      <section className="db-section">
        <h2 className="db-h2">
          Sources
          {docs && docs.length > 0 && <span className="db-count kb-count">{docs.length}</span>}
        </h2>
        {!docs ? (
          <ListSkeleton />
        ) : docs.length === 0 ? (
          <p className="db-empty">
            Nothing imported yet. Until you add something, the agent answers from the practice
            details it was set up with, and says it does not know the rest.
          </p>
        ) : (
          <ul className="db-queue">
            {docs.map((d) => (
              <li key={d.id} className="db-brief">
                <div className="db-brief-head">
                  <strong>{d.title}</strong>
                  <span className="db-chip">{d.sourceType}</span>
                  {d.status === 'indexed' ? (
                    <span className="db-chip">{d.chunkCount} passages</span>
                  ) : (
                    <span className="db-chip db-chip-alert">{d.status}</span>
                  )}
                  <span className="db-time">{new Date(d.createdAt).toLocaleDateString('en-IN')}</span>
                </div>
                {d.sourceRef && <p className="kb-ref">{d.sourceRef}</p>}
                {d.error && <p className="kb-ref kb-bad-text">{d.error}</p>}
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
