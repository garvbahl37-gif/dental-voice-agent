import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Lang, ServerEvent } from '@vaani/shared'
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

/**
 * Two switches in quick succession.
 *
 * A caller who asks for Punjabi and then changes their mind to English queues
 * two reconnects. Left unserialised they race to assign the session, and the
 * one that finishes last wins regardless of which language it was built for —
 * which is how a call that had moved to English started answering in Punjabi
 * again a turn later.
 */
describe('rapid language changes', () => {
  function connected() {
    const h = harness()
    const priv = h.session as unknown as {
      session: unknown
      resumeHandle: string | undefined
      switching: boolean
      pendingAccentSwitch: boolean
      openUtteranceId: string | null
      switchAccent(): Promise<void>
    }
    priv.session = { sendRealtimeInput: () => {} }
    priv.resumeHandle = 'handle'
    return { ...h, priv }
  }

  it('never runs two reconnects at once', () => {
    const { session, priv } = connected()
    const started: string[] = []
    let release: (() => void) | undefined
    priv.switchAccent = async () => {
      started.push('in')
      priv.switching = true
      await new Promise<void>((r) => (release = r))
      priv.switching = false
    }

    session.setLang('pa-IN')
    session.setLang('en-IN')

    expect(started.length).toBe(1)
    release?.()
  })

  it('ends on the language the caller actually chose last', async () => {
    const { session, priv } = connected()
    const built: Lang[] = []
    // Stand in for the reconnect, recording which language it was built for.
    priv.switchAccent = async function (this: unknown) {
      priv.switching = true
      const target = (session as unknown as { lang: Lang }).lang
      await Promise.resolve()
      built.push(target)
      priv.switching = false
      const now = (session as unknown as { lang: Lang }).lang
      if (now !== target) {
        priv.pendingAccentSwitch = true
        ;(session as unknown as { applyPendingAccent(): void }).applyPendingAccent()
      }
    }

    session.setLang('pa-IN')
    session.setLang('en-IN')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(built.at(-1)).toBe('en-IN')
  })
})

/**
 * When it is safe to change accent.
 *
 * The accent is fixed at connect, so following the caller costs a reconnect —
 * and a reconnect lands like a dropped line if it happens while she is talking.
 * These pin the three moments that matter, all of which were wrong at some
 * point: mid-sentence, mid-reply-before-she-starts, and at the end of a turn
 * that was cut off rather than finished.
 */
describe('when an accent switch is allowed to happen', () => {
  function connected() {
    const h = harness()
    const priv = h.session as unknown as {
      session: unknown
      resumeHandle: string | undefined
      switching: boolean
      pendingAccentSwitch: boolean
      openUtteranceId: string | null
      awaitingReply: boolean
      turnWasCut: boolean
      switchAccent(): Promise<void>
    }
    priv.session = { sendRealtimeInput: () => {} }
    priv.resumeHandle = 'handle'
    const switches: string[] = []
    priv.switchAccent = async () => {
      switches.push('go')
    }
    return { ...h, priv, switches }
  }

  it('switches at once when the line is genuinely quiet', () => {
    // Someone changing the picker between calls should hear it immediately.
    const { session, switches } = connected()
    session.setLang('ta-IN')
    expect(switches.length).toBe(1)
  })

  it('waits when the caller has spoken and the reply is still coming', () => {
    /**
     * The reported bug. `openUtteranceId` is only set once she is making
     * sound, but the model starts composing the moment the caller stops — and
     * a caller *asking* to switch has just spoken. Reconnecting there threw the
     * reply away after "हाँ जी,".
     */
    const { session, priv, switches, feed } = connected()
    feed({ serverContent: { inputTranscription: { text: 'can we talk in Hindi' } } })
    expect(priv.awaitingReply).toBe(true)

    session.setLang('hi-IN')
    expect(switches.length).toBe(0)

    feed({ serverContent: { turnComplete: true } })
    expect(switches.length).toBe(1)
  })

  it('does not switch on the end of a turn that was cut off', () => {
    /**
     * Live reports `interrupted` mid-reply even when nobody barged in. The
     * turn boundary that follows is not a real one, and switching on it split
     * one sentence across a reconnect.
     */
    const { session, switches, feed } = connected()
    feed({ serverContent: { inputTranscription: { text: 'hindi mein baat karo' } } })
    session.setLang('hi-IN')

    feed({ serverContent: { interrupted: true } })
    feed({ serverContent: { turnComplete: true } })
    expect(switches.length).toBe(0)

    // The next turn that ends properly carries it.
    feed({ serverContent: { turnComplete: true } })
    expect(switches.length).toBe(1)
  })

  it('still refuses to switch while she is mid-sentence', () => {
    const { session, priv, switches } = connected()
    priv.openUtteranceId = 'u1'
    session.setLang('ml-IN')
    expect(switches.length).toBe(0)
  })
})
