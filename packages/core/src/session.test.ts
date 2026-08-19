import { describe, it, expect } from 'vitest'
import { Session } from './session'
import { FakeClock, FakeTransport, FakeTools, Script, fakeProviders } from './testing/fakes'

function setup(replies: string[]) {
  const script = new Script()
  script.agentReplies.push(...replies)
  const clock = new FakeClock()
  const transport = new FakeTransport(script, clock)
  const tools = new FakeTools()
  const session = new Session({
    sessionId: 's1',
    transport,
    providers: fakeProviders(script),
    tools,
    systemPrompt: 'You are Priya, receptionist at Smile Dental.',
    voiceId: 'v1',
    now: clock.now,
  })
  return { script, clock, transport, tools, session }
}

const assistantTurns = (s: Session) =>
  s.history.filter((m) => m.role === 'assistant' && m.content.length > 0)

describe('Session — a complete turn', () => {
  it('transcribes, answers, and speaks', async () => {
    const { transport, session } = setup(['Sure I can help with that'])
    await session.start()
    await transport.speak('I need an appointment')
    await transport.settle()

    expect(transport.spokenByAgent().join(' ')).toContain('Sure I can help with that')
  })

  it('records the caller turn in history', async () => {
    const { transport, session } = setup(['Of course'])
    await session.start()
    await transport.speak('I need an appointment')
    await transport.settle()

    expect(session.history.find((m) => m.role === 'user')?.content).toBe('I need an appointment')
  })

  it('emits a final transcript for the caller turn', async () => {
    const { transport, session } = setup(['Of course'])
    await session.start()
    await transport.speak('I need a cleaning')
    await transport.settle()

    expect(transport.eventsOfType('stt.final')[0]?.text).toBe('I need a cleaning')
  })

  it('reports per-turn latency metrics', async () => {
    const { transport, session } = setup(['Of course'])
    await session.start()
    await transport.speak('hello')
    await transport.settle(120)

    expect(transport.eventsOfType('metrics.turn')).toHaveLength(1)
  })

  it('speaks a greeting when configured', async () => {
    const script = new Script()
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      systemPrompt: 'sys',
      voiceId: 'v1',
      greeting: 'Namaste, Smile Dental.',
      now: clock.now,
    })
    await session.start()
    expect(transport.spokenByAgent()).toContain('Namaste, Smile Dental.')
  })
})

describe('Session — barge-in', () => {
  it('records only the heard prefix in history', async () => {
    const { transport, session } = setup(['Doctor Sharma is available Thursday'])
    await session.start()
    await transport.speak('when is the doctor free')

    await transport.playUntil(1000) // caller heard "Doctor Sharma is"
    await transport.interrupt()
    await transport.settle()

    const last = assistantTurns(session).at(-1)!
    expect(last.content).toBe('Doctor Sharma is—')
  })

  it('never leaves unheard words in history', async () => {
    const { transport, session } = setup(['Doctor Sharma is available Thursday'])
    await session.start()
    await transport.speak('when is the doctor free')
    await transport.playUntil(1000)
    await transport.interrupt()
    await transport.settle()

    const last = assistantTurns(session).at(-1)!
    expect(last.content).not.toContain('Thursday')
    expect(last.content).not.toContain('available')
  })

  it('stops sending audio the moment the caller cuts in', async () => {
    const { transport, session } = setup(['a considerably longer sentence for the caller to cut'])
    await session.start()
    await transport.speak('hello')
    await transport.playUntil(200)
    await transport.interrupt()

    const atInterrupt = transport.audioSamplesSent()
    await transport.settle(30)
    expect(transport.audioSamplesSent()).toBe(atInterrupt)
  })

  it('tells the client where to strike through the transcript', async () => {
    const { transport, session } = setup(['Doctor Sharma is available Thursday'])
    await session.start()
    await transport.speak('when is the doctor free')
    await transport.playUntil(1000)
    await transport.interrupt()
    await transport.settle()

    const cancel = transport.eventsOfType('tts.cancel')[0]
    expect(cancel).toMatchObject({ spokenPrefix: 'Doctor Sharma is—', truncateAtMs: 1000 })
  })

  it('drops the whole utterance when interrupted before the first word landed', async () => {
    const { transport, session } = setup(['Doctor Sharma is available Thursday'])
    await session.start()
    await transport.speak('when is the doctor free')
    await transport.playUntil(50)
    await transport.interrupt()
    await transport.settle()

    expect(assistantTurns(session)).toHaveLength(0)
  })

  it('continues the conversation after an interruption', async () => {
    const { script, transport, session } = setup(['Doctor Sharma is available Thursday'])
    await session.start()
    await transport.speak('when is the doctor free')
    await transport.playUntil(1000)

    script.agentReplies.push('Friday it is')
    await transport.interruptWith('actually make it Friday')
    await transport.settle(150)

    const roles = session.history.filter((m) => m.role !== 'system').map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(session.history.at(-1)!.content).toContain('Friday it is')
  })
})

describe('Session — tools', () => {
  it('runs a tool call and continues to a spoken answer', async () => {
    const { script, transport, tools, session } = setup([])
    script.toolCallsToEmit.push([
      { id: 'c1', name: 'check_availability', args: { service: 'cleaning' } },
    ])
    script.agentReplies.push('Thursday at four is free')

    await session.start()
    await transport.speak('book me a cleaning')
    await transport.settle(150)

    expect(tools.calls.map((c) => c.name)).toEqual(['check_availability'])
    expect(transport.spokenByAgent().join(' ')).toContain('Thursday at four is free')
  })

  it('surfaces the tool call and its result to the console', async () => {
    const { script, transport, session } = setup([])
    script.toolCallsToEmit.push([
      { id: 'c1', name: 'check_availability', args: { service: 'cleaning' } },
    ])
    script.agentReplies.push('Done')

    await session.start()
    await transport.speak('book me a cleaning')
    await transport.settle(150)

    expect(transport.eventsOfType('tool.call')[0]).toMatchObject({ name: 'check_availability' })
    expect(transport.eventsOfType('tool.result')[0]).toMatchObject({ ok: true })
  })

  it('writes the tool result into history for the follow-up generation', async () => {
    const { script, transport, session } = setup([])
    script.toolCallsToEmit.push([{ id: 'c1', name: 'check_availability', args: {} }])
    script.agentReplies.push('Done')

    await session.start()
    await transport.speak('book me a cleaning')
    await transport.settle(150)

    expect(session.history.some((m) => m.role === 'tool' && m.toolName === 'check_availability')).toBe(
      true,
    )
  })
})

describe('Session — language mirroring', () => {
  it('adopts the language the caller used', async () => {
    const script = new Script()
    script.agentReplies.push('जी बिल्कुल')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script, 'hi-IN'),
      systemPrompt: 'sys',
      voiceId: 'v1',
      now: clock.now,
    })

    await session.start()
    await transport.speak('मुझे अपॉइंटमेंट चाहिए')
    await transport.settle()

    expect(session.currentLang).toBe('hi-IN')
    expect(transport.eventsOfType('lang.detected')[0]).toMatchObject({ lang: 'hi-IN' })
  })
})

describe('Session — backchannels do not take the floor', () => {
  it('keeps listening while acknowledging a long caller turn', async () => {
    const script = new Script()
    script.agentReplies.push('Got it, let me look.')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      systemPrompt: 'sys',
      voiceId: 'v1',
      now: clock.now,
      phraseFor: (key) => (key === 'backchannel' ? 'Mm-hmm.' : null),
    })
    await session.start()

    // A long caller turn earns a backchannel partway through. If that
    // acknowledgement is registered as an agent turn, endpointing stops and
    // the caller's turn is never completed.
    await transport.speakLong('I have been having this problem for about two weeks now', 5000)
    await transport.settle(150)

    expect(transport.eventsOfType('stt.final').length).toBe(1)
    expect(session.history.some((m) => m.role === 'user')).toBe(true)
  })

  it('never records a backchannel as something the agent said', async () => {
    const script = new Script()
    script.agentReplies.push('Understood.')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      systemPrompt: 'sys',
      voiceId: 'v1',
      now: clock.now,
      phraseFor: (key) => (key === 'backchannel' ? 'Mm-hmm.' : null),
    })
    await session.start()
    await transport.speakLong('a long rambling explanation of the symptoms', 5000)
    await transport.settle(150)

    expect(session.history.every((m) => !m.content.includes('Mm-hmm'))).toBe(true)
  })
})

describe('Session — utterances never overlap', () => {
  it('serialises speech so a backchannel cannot cut into a sentence', async () => {
    const script = new Script()
    script.agentReplies.push('Let me check the diary for you right now please hold on')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      systemPrompt: 'sys',
      voiceId: 'v1',
      now: clock.now,
      phraseFor: (key) => (key === 'backchannel' ? 'Mm-hmm.' : null),
    })

    // Record the wall-clock window each utterance occupies on the wire.
    const windows: { id: string; from: number }[] = []
    let tick = 0
    const originalSend = transport.send.bind(transport)
    transport.send = (e) => {
      tick++
      if (e.type === 'tts.begin') windows.push({ id: e.utteranceId, from: tick })
      originalSend(e)
    }

    await session.start()
    await transport.speakLong('a long caller turn that will earn a backchannel', 5000)
    await transport.settle(200)

    // No utterance may begin before the previous one has finished.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.from, `${windows[i]!.id} began before ${windows[i - 1]!.id} ended`)
        .toBeGreaterThanOrEqual(windows[i - 1]!.from)
    }
    expect(windows.length).toBeGreaterThan(1)
  })

  it('speaks a whole clause rather than a fragment', async () => {
    const { transport, session } = setup(['Sure, I can set that up for you.'])
    await session.start()
    await transport.speak('book me a cleaning')
    await transport.settle(150)

    // "Sure," alone has no prosodic relationship to what follows.
    const spoken = transport.spokenByAgent().filter((t) => t !== 'Namaste, Smile Dental.')
    for (const utterance of spoken) {
      expect(utterance.length, `fragment: "${utterance}"`).toBeGreaterThanOrEqual(8)
    }
  })
})

describe('Session — history never contains a turn twice', () => {
  it('does not duplicate spoken text alongside a tool call', async () => {
    const script = new Script()
    // The model speaks AND calls a tool in the same step — gpt-oss does this.
    script.toolCallsToEmit.push([{ id: 'c1', name: 'check_availability', args: {} }])
    script.agentReplies.push('We have Monday at ten in the morning.')

    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      tools: new FakeTools(),
      systemPrompt: 'sys',
      voiceId: 'v1',
      now: clock.now,
    })

    await session.start()
    await transport.speak('when are you free')
    await transport.settle(200)

    const assistantText = session.history
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join(' ')
    const occurrences = assistantText.split('We have Monday').length - 1
    expect(occurrences, `appeared ${occurrences} times in history`).toBeLessThanOrEqual(1)
  })

  it('records each spoken sentence exactly once across a tool loop', async () => {
    const script = new Script()
    script.toolCallsToEmit.push([{ id: 'c1', name: 'check_availability', args: {} }])
    script.agentReplies.push('Thursday at four works.')

    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      tools: new FakeTools(),
      systemPrompt: 'sys',
      voiceId: 'v1',
      now: clock.now,
    })

    await session.start()
    await transport.speak('any slots')
    await transport.settle(200)

    const spoken = transport.spokenByAgent()
    expect(new Set(spoken).size, `repeated utterance in ${JSON.stringify(spoken)}`).toBe(
      spoken.length,
    )
  })
})


describe('Session — speakerphone echo', () => {
  it('never transcribes the agent\'s own voice', async () => {
    // The bug this pins: on speakers the microphone returns Priya's output.
    // Pushing that into the recogniser fills the buffer with her own speech,
    // and the caller's words arrive buried in echo.
    const script = new Script()
    script.agentReplies.push('Let me check the diary for you now.')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)

    let pushedWhileSpeaking = 0
    const providers = fakeProviders(script)
    const innerStream = providers.stt.stream.bind(providers.stt)
    let session: Session

    providers.stt.stream = (opts) => {
      const stream = innerStream(opts)
      const push = stream.push.bind(stream)
      stream.push = (pcm) => {
        if (session && session.state === 'speaking') pushedWhileSpeaking++
        push(pcm)
      }
      return stream
    }

    session = new Session({
      sessionId: 's1',
      transport,
      providers,
      systemPrompt: 'sys',
      voiceId: 'v1',
      greeting: 'Good morning, this is Priya.',
      now: clock.now,
    })

    await session.start()
    transport.echoWhileAgentSpeaks(60)
    await transport.settle(40)

    expect(pushedWhileSpeaking, 'echo reached the recogniser').toBe(0)
  })

  it('still hears the caller once the agent stops', async () => {
    const { transport, session } = setup(['Of course.'])
    await session.start()
    await transport.speak('I need an appointment')
    await transport.settle(60)

    expect(session.history.find((m) => m.role === 'user')?.content).toBe('I need an appointment')
  })
})
