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
          sendRealtimeInput: () => {},
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
