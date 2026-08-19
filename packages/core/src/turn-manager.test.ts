import { describe, it, expect, vi } from 'vitest'
import { TurnManager } from './turn-manager'
import type { WordMark } from '@vaani/shared'

/**
 * Every timing test drives an injected clock. No `setTimeout`, no real waiting,
 * no flake — turn-taking is the most timing-sensitive logic in the system and
 * it deserves deterministic tests.
 */
function harness() {
  let t = 0
  const emit = {
    stateChange: vi.fn(),
    endpoint: vi.fn(),
    bargeIn: vi.fn(),
    backchannel: vi.fn(),
    silence: vi.fn(),
  }
  const tm = new TurnManager({ now: () => t, emit })
  return {
    tm,
    emit,
    at: () => t,
    advance: (ms: number) => {
      t += ms
      tm.tick()
    },
  }
}

const oneWord: WordMark[] = [{ word: 'Doctor', startMs: 0, endMs: 400 }]
const sentence: WordMark[] = [
  { word: 'Doctor', startMs: 0, endMs: 400 },
  { word: 'Sharma', startMs: 400, endMs: 850 },
  { word: 'is', startMs: 850, endMs: 980 },
  { word: 'available', startMs: 980, endMs: 1600 },
]

describe('TurnManager — listening and endpointing', () => {
  it('starts idle', () => {
    const { tm } = harness()
    expect(tm.state).toBe('idle')
  })

  it('enters listening when the caller starts speaking', () => {
    const { tm } = harness()
    tm.onVadSpeechStart()
    expect(tm.state).toBe('listening')
  })

  it('does not endpoint before the silence threshold elapses', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    tm.onPartial('book an appointment', 'en-IN')
    tm.onVadSpeechEnd()
    advance(500)
    expect(emit.endpoint).not.toHaveBeenCalled()
  })

  it('endpoints once the silence threshold elapses', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    tm.onPartial('book an appointment', 'en-IN')
    tm.onVadSpeechEnd()
    advance(650)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })

  it('endpoints exactly once even if ticked repeatedly', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    tm.onPartial('book an appointment', 'en-IN')
    tm.onVadSpeechEnd()
    advance(650)
    advance(650)
    advance(650)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })

  it('extends the wait when the caller trails off mid-sentence', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    tm.onPartial('my name is', 'en-IN')
    tm.onVadSpeechEnd()
    advance(650)
    expect(emit.endpoint).not.toHaveBeenCalled() // needs 1100ms
    advance(500)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })

  it('cuts in faster after the agent asked a yes/no question', () => {
    const { tm, emit, advance } = harness()
    tm.onAgentSpeakStart('u1', oneWord, 'Does Thursday at four work for you?')
    tm.onPlaybackComplete('u1')
    tm.onVadSpeechStart()
    tm.onPartial('yes', 'en-IN')
    tm.onVadSpeechEnd()
    advance(460)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })

  it('waits longer after the agent asked an open question', () => {
    const { tm, emit, advance } = harness()
    tm.onAgentSpeakStart('u1', oneWord, 'How can I help you today?')
    tm.onPlaybackComplete('u1')
    tm.onVadSpeechStart()
    tm.onPartial('i need a cleaning', 'en-IN')
    tm.onVadSpeechEnd()
    advance(700)
    expect(emit.endpoint).not.toHaveBeenCalled()
    advance(250)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })

  it('cancels a pending endpoint when the caller resumes', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    tm.onPartial('i want', 'en-IN')
    tm.onVadSpeechEnd()
    advance(400)
    tm.onVadSpeechStart()
    advance(400)
    expect(emit.endpoint).not.toHaveBeenCalled()
  })

  it('endpoints on the second pause after a resume', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    tm.onPartial('i want', 'en-IN')
    tm.onVadSpeechEnd()
    advance(400)
    tm.onVadSpeechStart()
    tm.onPartial('i want a cleaning', 'en-IN')
    tm.onVadSpeechEnd()
    advance(650)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })
})

describe('TurnManager — barge-in', () => {
  it('reports speaking state while the agent holds the floor', () => {
    const { tm } = harness()
    tm.onAgentSpeakStart('u1', sentence, 'Doctor Sharma is available')
    expect(tm.state).toBe('speaking')
  })

  it('fires barge-in when the caller speaks over the agent', () => {
    const { tm, emit } = harness()
    tm.onAgentSpeakStart('u1', sentence, 'Doctor Sharma is available')
    tm.onPlaybackProgress('u1', 980)
    tm.onVadSpeechStart()
    expect(emit.bargeIn).toHaveBeenCalledWith({
      utteranceId: 'u1',
      truncateAtMs: 980,
      marks: sentence,
    })
  })

  it('returns to listening after a barge-in', () => {
    const { tm } = harness()
    tm.onAgentSpeakStart('u1', sentence, 'Doctor Sharma is available')
    tm.onPlaybackProgress('u1', 500)
    tm.onVadSpeechStart()
    expect(tm.state).toBe('listening')
  })

  it('does not fire barge-in when the agent is not speaking', () => {
    const { tm, emit } = harness()
    tm.onVadSpeechStart()
    expect(emit.bargeIn).not.toHaveBeenCalled()
  })

  it('fires barge-in only once per utterance', () => {
    const { tm, emit } = harness()
    tm.onAgentSpeakStart('u1', sentence, 'Doctor Sharma is available')
    tm.onPlaybackProgress('u1', 500)
    tm.onVadSpeechStart()
    tm.onVadSpeechStart()
    expect(emit.bargeIn).toHaveBeenCalledOnce()
  })

  it('ignores playback progress for a stale utterance', () => {
    const { tm, emit } = harness()
    tm.onAgentSpeakStart('u2', sentence, 'Doctor Sharma is available')
    tm.onPlaybackProgress('u1', 1500) // late frame from the previous utterance
    tm.onVadSpeechStart()
    expect(emit.bargeIn).toHaveBeenCalledWith({
      utteranceId: 'u2',
      truncateAtMs: 0,
      marks: sentence,
    })
  })

  it('endpoints normally after an interrupting turn completes', () => {
    const { tm, emit, advance } = harness()
    tm.onAgentSpeakStart('u1', sentence, 'Doctor Sharma is available')
    tm.onPlaybackProgress('u1', 500)
    tm.onVadSpeechStart()
    tm.onPartial('actually make it friday', 'en-IN')
    tm.onVadSpeechEnd()
    advance(650)
    expect(emit.endpoint).toHaveBeenCalledOnce()
  })
})

describe('TurnManager — backchannels', () => {
  it('emits a backchannel when the caller speaks for a long stretch', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    advance(4100)
    expect(emit.backchannel).toHaveBeenCalledOnce()
  })

  it('does not emit a backchannel for a short turn', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    advance(2000)
    expect(emit.backchannel).not.toHaveBeenCalled()
  })

  it('keeps acknowledging through a very long turn', () => {
    const { tm, emit, advance } = harness()
    tm.onVadSpeechStart()
    advance(4100)
    advance(4100)
    expect(emit.backchannel).toHaveBeenCalledTimes(2)
  })

  it('does not backchannel over the agent itself', () => {
    const { tm, emit, advance } = harness()
    tm.onAgentSpeakStart('u1', sentence, 'Doctor Sharma is available')
    advance(5000)
    expect(emit.backchannel).not.toHaveBeenCalled()
  })
})

describe('TurnManager — state transitions', () => {
  it('announces every state change exactly once', () => {
    const { tm, emit } = harness()
    tm.onVadSpeechStart()
    tm.onVadSpeechStart() // already listening
    expect(emit.stateChange).toHaveBeenCalledTimes(1)
    expect(emit.stateChange).toHaveBeenCalledWith('listening')
  })

  it('moves through thinking and tool_running to speaking', () => {
    const { tm, emit } = harness()
    tm.setState('thinking')
    tm.setState('tool_running')
    tm.onAgentSpeakStart('u1', oneWord, 'Booked.')
    expect(emit.stateChange.mock.calls.map((c) => c[0])).toEqual([
      'thinking',
      'tool_running',
      'speaking',
    ])
  })

  it('returns to idle when playback completes', () => {
    const { tm } = harness()
    tm.onAgentSpeakStart('u1', oneWord, 'Booked.')
    tm.onPlaybackComplete('u1')
    expect(tm.state).toBe('idle')
  })
})

describe('TurnManager — silence (spec §26)', () => {
  it('says nothing for a short pause', () => {
    const { tm, emit, advance } = harness()
    advance(3000)
    expect(emit.silence).not.toHaveBeenCalled()
  })

  it('nudges once the pause becomes awkward', () => {
    const { emit, advance } = harness()
    advance(6500)
    expect(emit.silence).toHaveBeenCalledWith('nudge')
  })

  it('escalates rather than repeating itself', () => {
    // "Hello? Hello? Hello?" is the most machine-like thing an agent can do.
    const { emit, advance } = harness()
    advance(6500)
    advance(8000)
    expect(emit.silence.mock.calls.map((c) => c[0])).toEqual(['nudge', 'checkIn'])
  })

  it('closes the line only after a long silence', () => {
    const { emit, advance } = harness()
    advance(6500)
    advance(8000)
    advance(17000)
    expect(emit.silence.mock.calls.map((c) => c[0])).toEqual(['nudge', 'checkIn', 'hangUp'])
  })

  it('resets the ladder the moment the caller speaks', () => {
    const { tm, emit, advance } = harness()
    advance(6500)
    tm.onVadSpeechStart()
    tm.onVadSpeechEnd()
    advance(3000)
    expect(emit.silence).toHaveBeenCalledTimes(1)
  })

  it('never nudges while the agent is speaking', () => {
    const { tm, emit, advance } = harness()
    tm.onAgentSpeakStart('u1', oneWord, 'A long answer.')
    advance(20000)
    expect(emit.silence).not.toHaveBeenCalled()
  })
})
