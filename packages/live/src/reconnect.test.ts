import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServerEvent } from '@vaani/shared'

/**
 * Which socket a close belongs to.
 *
 * Swapping accents deliberately closes the old socket, and that close arrives
 * whenever the network gets round to it — a second later, in the production
 * trace that found this. The old code suppressed the dropped-line recovery with
 * a flag held across the swap, which was down again by the time the event
 * landed: the freshly connected session was torn down and replaced by a second
 * reconnect, and the caller spoke into several seconds of nothing.
 */

interface FakeSocket {
  callbacks: {
    onopen: () => void
    onmessage: (m: unknown) => void
    onerror: (e: unknown) => void
    onclose: (e: unknown) => void
  }
  closed: boolean
}

const sockets: FakeSocket[] = []
/** Realtime text sent to Live — which Live counts as the caller talking. */
const nudges: string[] = []

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GoogleGenAI: class {
    live = {
      connect: async ({ callbacks }: { callbacks: FakeSocket['callbacks'] }) => {
        const socket: FakeSocket = { callbacks, closed: false }
        sockets.push(socket)
        callbacks.onopen()
        return {
          close: () => {
            socket.closed = true
          },
          sendClientContent: () => {},
          sendRealtimeInput: (input: { text?: string }) => {
            if (input.text) nudges.push(input.text)
          },
          sendToolResponse: () => {},
        }
      },
    }
  },
}))

const { LiveSession } = await import('./session')

function harness() {
  const events: ServerEvent[] = []
  const session = new LiveSession({
    sessionId: 'test',
    apiKey: 'unused — the socket is faked',
    systemInstruction: '',
    lang: 'en-IN',
    tools: { defs: () => [], run: async () => ({ ok: true, result: null }) },
    send: (e) => events.push(e),
    sendAudio: () => {},
  })
  const inner = session as unknown as {
    resumeHandle: string | undefined
    onMessage(m: unknown): void
  }
  return { events, session, inner }
}

const connects = (events: ServerEvent[]) => events.filter((e) => e.type === 'session.ready').length

/** Live only lets a session resume if it has handed over a handle first. */
const withHandle = (inner: { resumeHandle: string | undefined }) => {
  inner.resumeHandle = 'handle-1'
}

beforeEach(() => {
  sockets.length = 0
  nudges.length = 0
})

describe('a socket that closes after it has been replaced', () => {
  it('does not count as a dropped line', async () => {
    const { events, session, inner } = harness()
    await session.start()
    withHandle(inner)

    // A language whose accent differs, on a quiet line: the switch is immediate.
    session.setLang('ta-IN')
    // Not `session.ready`: that is emitted from inside `connect`, while the swap
    // is still in progress. The close this test is about arrives *after* the
    // swap has finished and tidied up, which is the whole reason it was missed.
    await vi.waitFor(() => expect(sockets[0]?.closed).toBe(true))
    await new Promise((r) => setTimeout(r, 20))

    // The old socket's close finally lands, well after the swap finished.
    sockets[0]!.callbacks.onclose({ reason: 'replaced' })
    // Long enough for the dropped-line backoff to have fired if it were going
    // to. Waiting less than that is how this test used to pass on the bug.
    await new Promise((r) => setTimeout(r, 1200))

    expect(connects(events)).toBe(2)
    expect(sockets).toHaveLength(2)
  })

  it('still recovers when the socket actually in use drops', async () => {
    const { events, session, inner } = harness()
    await session.start()
    withHandle(inner)

    sockets[0]!.callbacks.onclose({ reason: 'network' })

    await vi.waitFor(() => expect(connects(events)).toBe(2), { timeout: 3000 })
  })

  it('ignores what a replaced socket says about the call', async () => {
    const { events, session, inner } = harness()
    await session.start()
    withHandle(inner)

    session.setLang('ta-IN')
    await vi.waitFor(() => expect(connects(events)).toBe(2))

    const before = events.length
    sockets[0]!.callbacks.onmessage({
      serverContent: { outputTranscription: { text: 'from a conversation that moved on' } },
    })

    expect(events).toHaveLength(before)
  })

  it('does not report an error from a socket nobody is listening to', async () => {
    const { events, session, inner } = harness()
    await session.start()
    withHandle(inner)

    session.setLang('ta-IN')
    await vi.waitFor(() => expect(connects(events)).toBe(2))

    sockets[0]!.callbacks.onerror(new Error('the old line, complaining'))

    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
  })

  it('closes the socket it replaced rather than leaving it open', async () => {
    const { session, events, inner } = harness()
    await session.start()
    withHandle(inner)

    session.setLang('ta-IN')
    // `onopen` fires inside `connect`, so the new session is announced before
    // the swap has finished tidying up. Wait for the tidying, not the announcement.
    await vi.waitFor(() => expect(sockets[0]?.closed).toBe(true))

    expect(connects(events)).toBe(2)
    expect(sockets[1]!.closed).toBe(false)
  })
})

/**
 * Live counts realtime text as the caller speaking. Sent while a reply is being
 * composed it is a barge-in: the model throws the reply away and starts again.
 * The trace that found this showed `interrupted` eight milliseconds after the
 * language was detected, "हाँ जी," discarded, and three seconds of silence
 * before she spoke — which on the phone is the agent taking six seconds to
 * answer a simple question.
 */
describe('the mid-call language nudge', () => {
  const heard = (text: string) => ({ serverContent: { inputTranscription: { text } } })
  const replies = (text: string) => ({ serverContent: { outputTranscription: { text } } })
  const done = { serverContent: { turnComplete: true } }

  it('goes out at once when the line is quiet', async () => {
    const { session } = harness()
    await session.start()

    // Same accent as Hindi, so nothing reconnects and the nudge is all there is.
    session.setLang('hi-Latn-IN')

    expect(nudges).toHaveLength(1)
    expect(nudges[0]).toContain('Hinglish')
  })

  it('waits while she is answering, rather than cutting her off', async () => {
    const { session, inner } = harness()
    await session.start()

    inner.onMessage(heard('kya hum Hindi mein baat kar sakte hain'))
    inner.onMessage(replies('हाँ जी,'))
    session.setLang('hi-Latn-IN')

    expect(nudges).toHaveLength(0)

    inner.onMessage(done)
    expect(nudges).toHaveLength(1)
  })

  it('waits even before her first word, while the reply is being composed', async () => {
    const { session, inner } = harness()
    await session.start()

    // The caller has stopped and the model is composing: nothing is audible
    // yet, and text sent here is exactly what threw the reply away.
    inner.onMessage(heard('ab Hindi mein baat kijiye'))
    session.setLang('hi-Latn-IN')

    expect(nudges).toHaveLength(0)
  })

  it('is dropped when a reconnect will carry the whole prompt instead', async () => {
    const { session, inner } = harness()
    await session.start()
    withHandle(inner)

    inner.onMessage(heard('please speak Tamil'))
    session.setLang('ta-IN')
    expect(nudges).toHaveLength(0)

    inner.onMessage(done)

    // The rebuilt instruction says everything the nudge would have, in full.
    expect(nudges).toHaveLength(0)
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
  })

  it('sends only the language in play when the caller changes their mind twice', async () => {
    const { session, inner } = harness()
    await session.start()

    inner.onMessage(heard('actually'))
    session.setLang('hi-Latn-IN')
    session.setLang('hi-IN')
    inner.onMessage(done)

    expect(nudges).toHaveLength(1)
    expect(nudges[0]).toContain('Devanagari')
  })
})
