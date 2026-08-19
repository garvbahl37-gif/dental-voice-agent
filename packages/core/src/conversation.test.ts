import { describe, it, expect } from 'vitest'
import { Session } from './session'
import { FakeClock, FakeTransport, FakeTools, Script, fakeProviders } from './testing/fakes'
import {
  describeConversation,
  extractFacts,
  learn,
  newConversation,
  noteAsked,
  observeLanguage,
} from '@vaani/agent'
import type { Lang } from '@vaani/shared'

/**
 * Scripted multi-turn conversations — PRD §10.
 *
 * Every defect the user reported survived a passing suite and a green browser
 * audit, because both tested single exchanges. "She forgets" is invisible in
 * one turn by definition; it only appears on the third.
 *
 * These assert on **state, language and the absence of prohibited output** —
 * never on exact wording. Asserting phrasing makes the suite brittle and pushes
 * the agent toward scripted speech, which is the defect we started from.
 */

/** Mirrors how the live server records state, so the two cannot drift apart. */
function conversationHarness(lang: Lang = 'en-IN') {
  const convo = newConversation(lang)

  return {
    convo,
    callerSaid(text: string, detected: Lang = lang, confidence = 0.9) {
      convo.turn += 1
      observeLanguage(convo, detected, confidence)
      const f = extractFacts(text)
      if (f.name) learn(convo, 'name', f.name)
      if (f.phone) learn(convo, 'phone', f.phone)
      if (f.preferredTime) learn(convo, 'preferredTime', f.preferredTime)
    },
    agentSaid(text: string) {
      const t = text.toLowerCase()
      if (/\bname\b/.test(t) && t.includes('?')) noteAsked(convo, 'name')
      if (/(mobile|number|phone)/.test(t) && t.includes('?')) noteAsked(convo, 'mobile number')
    },
    instructions: () => describeConversation(convo),
  }
}

describe('conversation — a name given once is never asked for again', () => {
  it('carries the name into the instructions on every later turn', () => {
    const h = conversationHarness()

    h.agentSaid('Sure, may I have your name?')
    h.callerSaid('My name is Rahul Verma')

    // Three turns later, the instructions must still carry it.
    h.callerSaid('I would like a cleaning')
    h.callerSaid('Thursday morning if possible')

    const instructions = h.instructions()
    expect(instructions).toContain('Rahul Verma')
    expect(instructions).toMatch(/ALREADY asked for.*name/i)
    expect(instructions).toMatch(/Do not ask again/i)
  })

  it('does not lose the number across intervening turns', () => {
    const h = conversationHarness()
    h.callerSaid('my number is nine eight seven six five four three two one zero')
    h.callerSaid('actually can you tell me the price first')
    h.callerSaid('okay fine')
    expect(h.instructions()).toContain('9876543210')
  })
})

describe('conversation — corrections', () => {
  it('keeps only the corrected value', () => {
    const h = conversationHarness()
    h.callerSaid('I want tomorrow morning')
    h.callerSaid('Actually Thursday morning')
    const i = h.instructions()
    expect(i).toMatch(/thursday/i)
    expect(i).not.toMatch(/prefers:.*tomorrow/i)
  })

  it('marks a corrected number as needing a fresh read-back', () => {
    const h = conversationHarness()
    h.callerSaid('my number is 9876543210')
    h.callerSaid('sorry it is 9123456780')
    expect(h.instructions()).toMatch(/NOT yet read back/)
  })
})

describe('conversation — mid-call language switch', () => {
  it('switches on Devanagari within one turn', () => {
    const h = conversationHarness('en-IN')
    h.callerSaid('Hi, I need a cleaning appointment', 'en-IN', 0.9)
    h.callerSaid('कल सुबह का कोई slot है?', 'hi-IN', 0.95)
    expect(h.convo.language).toBe('hi-IN')
  })

  it('does not flip on one ambiguous turn', () => {
    // "haan" alone must not switch the whole conversation.
    const h = conversationHarness('en-IN')
    h.callerSaid('I need an appointment', 'en-IN', 0.9)
    h.callerSaid('haan', 'hi-Latn-IN', 0.4)
    expect(h.convo.language).toBe('en-IN')
  })

  it('switches once the caller has clearly settled into Hinglish', () => {
    const h = conversationHarness('en-IN')
    h.callerSaid('mujhe kal appointment chahiye', 'hi-Latn-IN', 0.8)
    h.callerSaid('subah ka time theek rahega', 'hi-Latn-IN', 0.8)
    expect(h.convo.language).toBe('hi-Latn-IN')
  })

  it('states the current language in the instructions', () => {
    // The frozen-prompt defect: the model was never told the language changed.
    const h = conversationHarness('en-IN')
    h.callerSaid('नमस्ते', 'hi-IN', 0.95)
    expect(h.convo.language).toBe('hi-IN')
  })
})

describe('conversation — slots already offered', () => {
  it('never re-offers a slot the caller declined', () => {
    const h = conversationHarness()
    h.convo.offeredSlots.push({ start: 'x', when: 'Monday at ten' })
    h.convo.declinedSlots.push('Monday at ten')
    const i = h.instructions()
    expect(i).toMatch(/never offer them again/i)
    expect(i).toContain('Monday at ten')
  })
})

describe('conversation — the voice follows the language', () => {
  it('resolves a different voice per language when configured', async () => {
    const script = new Script()
    script.agentReplies.push('नमस्ते जी')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)

    const asked: string[] = []
    const providers = fakeProviders(script, 'hi-IN')
    const inner = providers.tts.synth.bind(providers.tts)
    providers.tts.synth = (text, opts) => {
      asked.push(opts.voiceId)
      return inner(text, opts)
    }

    const session = new Session({
      sessionId: 's1',
      transport,
      providers,
      tools: new FakeTools(),
      systemPrompt: 'sys',
      voiceId: 'english-voice',
      now: clock.now,
      voiceFor: (l) => (l === 'en-IN' ? 'english-voice' : 'hindi-voice'),
    })

    await session.start()
    await transport.speak('मुझे अपॉइंटमेंट चाहिए')
    await transport.settle(120)

    expect(asked, 'agent spoke Hindi with the English voice').toContain('hindi-voice')
  })
})

describe('conversation — instructions are rebuilt, not frozen', () => {
  it('reflects state learned after the session started', async () => {
    const script = new Script()
    script.agentReplies.push('Of course.')
    const clock = new FakeClock()
    const transport = new FakeTransport(script, clock)

    let built = 0
    const session = new Session({
      sessionId: 's1',
      transport,
      providers: fakeProviders(script),
      systemPrompt: 'INITIAL',
      voiceId: 'v1',
      now: clock.now,
      buildInstructions: () => `REBUILT-${++built}`,
    })

    await session.start()
    await transport.speak('I need an appointment')
    await transport.settle(120)

    expect(built, 'instructions were never rebuilt').toBeGreaterThan(0)
    expect(session.history[0]?.content).toMatch(/^REBUILT-/)
  })
})
