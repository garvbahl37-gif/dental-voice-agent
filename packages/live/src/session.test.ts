import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ServerEvent } from '@vaani/shared'
import { LiveSession } from './session'

/**
 * Turn boundaries in the transcript.
 *
 * Live never says "the caller stopped talking". It streams transcription
 * fragments and then, some time later, starts a reply — so the boundary has to
 * be inferred, and inferring it wrongly is what made the console append
 * everything the caller said into one run-on bubble.
 *
 * These drive the message handler directly. It is private, but it is where the
 * decision lives, and the alternative is a live API call in a unit test.
 */

function harness() {
  const events: ServerEvent[] = []
  const session = new LiveSession({
    sessionId: 'test',
    apiKey: 'unused — nothing connects here',
    systemInstruction: '',
    lang: 'en-IN',
    tools: { defs: () => [], run: async () => ({ ok: true, result: null }) },
    send: (e) => events.push(e),
    sendAudio: () => {},
  })
  // The handler is what is under test; connecting is not.
  const feed = (m: unknown) => (session as unknown as { onMessage(m: unknown): void }).onMessage(m)
  return { events, feed, session }
}

const heard = (text: string) => ({ serverContent: { inputTranscription: { text } } })
const replies = (text: string) => ({ serverContent: { outputTranscription: { text } } })

describe('caller turn boundaries', () => {
  it('gives each utterance its own id', () => {
    const { events, feed } = harness()

    feed(heard('I need an appointment'))
    feed(replies('Of course.'))
    feed({ serverContent: { turnComplete: true } })
    feed(heard('tomorrow morning'))

    const ids = events.filter((e) => e.type === 'stt.partial').map((e) => e.turnId)
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps one utterance under one id while it is still being spoken', () => {
    const { events, feed } = harness()

    feed(heard('I need '))
    feed(heard('an appointment'))

    const partials = events.filter((e) => e.type === 'stt.partial')
    expect(partials.map((p) => p.turnId)).toEqual([partials[0]!.turnId, partials[0]!.turnId])
    // The text accumulates rather than replacing.
    expect(partials.at(-1)!.text).toBe('I need an appointment')
  })

  it('settles the caller before the reply, not after it', () => {
    /**
     * The reason the transcript used to read back to front: `stt.final` landed
     * only at `turnComplete`, which is after the agent's whole answer, so the
     * caller's words arrived below the reply that answered them.
     */
    const { events, feed } = harness()

    feed(heard('do you open on Sunday'))
    feed(replies('We do not.'))

    const order = events.map((e) => e.type)
    expect(order.indexOf('stt.final')).toBeGreaterThan(-1)
    expect(order.indexOf('stt.final')).toBeLessThan(order.indexOf('tts.begin'))
  })

  it('starts a new bubble when the caller speaks twice before any reply', () => {
    // The reported bug: the second thing said was appended to the first.
    const { events, feed } = harness()

    feed(heard('hello'))
    feed(replies('Good morning.'))
    feed({ serverContent: { turnComplete: true } })
    feed(heard('actually, cancel it'))

    const partials = events.filter((e) => e.type === 'stt.partial')
    expect(partials[0]!.turnId).not.toBe(partials.at(-1)!.turnId)
    expect(partials.at(-1)!.text).toBe('actually, cancel it')
  })

  it('does not settle an utterance that was only silence', () => {
    const { events, feed } = harness()
    feed(heard('   '))
    feed(replies('Hello?'))
    expect(events.some((e) => e.type === 'stt.final')).toBe(false)
  })
})

describe('thinking', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports thinking once the caller goes quiet', () => {
    const { events, feed } = harness()
    feed(heard('how much is a cleaning'))

    expect(events.some((e) => e.type === 'agent.state' && e.state === 'thinking')).toBe(false)
    vi.advanceTimersByTime(500)
    expect(events.some((e) => e.type === 'agent.state' && e.state === 'thinking')).toBe(true)
  })

  it('does not report thinking while the caller is still talking', () => {
    const { events, feed } = harness()
    feed(heard('how much '))
    vi.advanceTimersByTime(200)
    feed(heard('is a cleaning'))
    vi.advanceTimersByTime(200)

    // The timer restarts with each fragment, so a pause between words is not a
    // pause in the sentence.
    expect(events.some((e) => e.type === 'agent.state' && e.state === 'thinking')).toBe(false)
  })

  it('stops thinking the moment the reply starts', () => {
    const { events, feed } = harness()
    feed(heard('hello'))
    feed(replies('Good morning.'))
    vi.advanceTimersByTime(1000)

    const states = events.filter((e) => e.type === 'agent.state').map((e) => e.state)
    expect(states).toContain('speaking')
    expect(states).not.toContain('thinking')
  })
})

/**
 * Changing accent mid-call.
 *
 * `speechConfig.languageCode` is fixed at connect, so following the caller
 * costs a reconnect carried by the resumption handle. Both of these were real
 * bugs: the switch was dropped outright if it came before the first handle
 * arrived, and otherwise waited for a turn boundary that had already passed.
 */
describe('accent switching', () => {
  function connected() {
    const h = harness()
    const priv = h.session as unknown as {
      session: unknown
      resumeHandle: string | undefined
      pendingAccentSwitch: boolean
      openUtteranceId: string | null
      switchAccent(): Promise<void>
    }
    priv.session = { sendRealtimeInput: () => {} }
    const switches: number[] = []
    priv.switchAccent = async () => {
      switches.push(1)
    }
    return { ...h, priv, switches }
  }

  it('switches straight away when nobody is mid-sentence', () => {
    const { session, priv, switches } = connected()
    priv.resumeHandle = 'handle'

    session.setLang('ta-IN')

    expect(switches.length).toBe(1)
    expect(priv.pendingAccentSwitch).toBe(false)
  })

  it('waits for the turn to end when the agent is speaking', () => {
    const { session, priv, switches, feed } = connected()
    priv.resumeHandle = 'handle'
    priv.openUtteranceId = 'u1'

    session.setLang('ta-IN')
    expect(switches.length).toBe(0)
    expect(priv.pendingAccentSwitch).toBe(true)

    feed({ serverContent: { turnComplete: true } })
    expect(switches.length).toBe(1)
  })

  it('keeps the switch pending until a resumption handle exists', () => {
    // Without a handle a reconnect would restart the conversation rather than
    // continue it, so it has to wait — and it used to be thrown away instead.
    const { session, priv, switches, feed } = connected()
    priv.resumeHandle = undefined

    session.setLang('ta-IN')
    expect(switches.length).toBe(0)
    expect(priv.pendingAccentSwitch).toBe(true)

    priv.resumeHandle = 'arrived-later'
    feed({ serverContent: { turnComplete: true } })
    expect(switches.length).toBe(1)
  })

  it('does not reconnect between languages that share an accent', () => {
    // Hinglish is Hindi speech that borrows English nouns; nothing changes.
    const { session, priv, switches } = connected()
    priv.resumeHandle = 'handle'

    session.setLang('hi-IN')
    switches.length = 0
    session.setLang('hi-Latn-IN')

    expect(switches.length).toBe(0)
  })

  it('reconnects between two regional languages', () => {
    /**
     * The bug this guards: every Indian language was bucketed into one "hi"
     * accent, so Tamil to Malayalam looked like no change at all and the call
     * kept the wrong mouth.
     */
    const { session, priv, switches } = connected()
    priv.resumeHandle = 'handle'

    session.setLang('ta-IN')
    switches.length = 0
    session.setLang('ml-IN')

    expect(switches.length).toBe(1)
  })
})
