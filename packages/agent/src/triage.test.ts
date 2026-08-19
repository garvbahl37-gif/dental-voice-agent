import { describe, it, expect } from 'vitest'
import { triage } from './triage'
import { guard, speakable, stripStageDirections } from './safety'
import { ALL_LANGS } from '@vaani/shared'

describe('triage — RED band', () => {
  it('escalates difficulty breathing', () => {
    expect(triage('I am having difficulty breathing and my face is swollen').band).toBe('red')
  })

  it('escalates swelling near the eye', () => {
    expect(triage('there is swelling near my eye since morning').band).toBe('red')
  })

  it('escalates a knocked-out tooth', () => {
    const r = triage('my son fell and his tooth got knocked out')
    expect(r.band).toBe('red')
    expect(r.reason).toMatch(/30 minutes/)
  })

  it('escalates a knocked-out tooth described in Hindi', () => {
    expect(triage('mera poora daant nikal gaya hai gir kar').band).toBe('red')
  })

  it('escalates uncontrolled bleeding', () => {
    expect(triage("the bleeding won't stop after extraction").band).toBe('red')
  })

  it('escalates trouble swallowing in Devanagari', () => {
    expect(triage('मुझे निगलने में दिक्कत हो रही है').band).toBe('red')
  })

  it('alerts the practice on every red case', () => {
    expect(triage('I cannot breathe properly').alertPractice).toBe(true)
  })

  it('leaves no room to book a routine slot on red', () => {
    expect(triage('my jaw is broken from an accident').bookWithinDays).toBe(0)
  })
})

describe('triage — AMBER band', () => {
  it('flags severe pain as urgent', () => {
    expect(triage('I have severe pain and cannot sleep').band).toBe('amber')
  })

  it('flags severe pain described in romanised Hindi', () => {
    expect(triage('bahut zyada dard ho raha hai').band).toBe('amber')
  })

  it('flags an abscess', () => {
    expect(triage('there is pus coming from my gum').band).toBe('amber')
  })

  it('flags a broken tooth', () => {
    expect(triage('I chipped my front tooth yesterday').band).toBe('amber')
  })

  it('books amber cases within a day or two', () => {
    expect(triage('severe pain in my molar').bookWithinDays).toBeLessThanOrEqual(2)
  })
})

describe('triage — GREEN band', () => {
  it('treats a routine cleaning as routine', () => {
    expect(triage('I want to book a cleaning').band).toBe('green')
  })

  it('treats a cosmetic enquiry as routine', () => {
    expect(triage('how much does teeth whitening cost').band).toBe('green')
  })

  it('does not escalate mild sensitivity', () => {
    expect(triage('my teeth feel a bit sensitive to cold').band).toBe('green')
  })
})

describe('triage — scripts', () => {
  it('provides a script in every language for every band', () => {
    for (const input of ['I cannot breathe', 'severe pain', 'book a cleaning']) {
      const r = triage(input)
      for (const lang of ALL_LANGS) expect(r.script[lang]).toBeTruthy()
    }
  })

  it('directs red cases to emergency care rather than a dental chair', () => {
    expect(triage('difficulty swallowing and swelling').script['en-IN']).toMatch(/emergency room/i)
  })
})

describe('safety guard — diagnosis', () => {
  it('blocks a stated diagnosis', () => {
    const r = guard('You have an abscess in that tooth.', 'en-IN')
    expect(r.safe).toBe(false)
    expect(r.violation).toBe('diagnosis')
  })

  it('replaces the utterance with a safe deferral', () => {
    const r = guard('You have an infection there.', 'en-IN')
    expect(r.text).not.toContain('infection')
    expect(r.text).toMatch(/dentist/i)
  })

  it('blocks a diagnosis in romanised Hindi', () => {
    expect(guard('Aapko wahan infection hai.', 'hi-Latn-IN').safe).toBe(false)
  })

  it('answers in the language the caller was using', () => {
    expect(guard('You have an abscess.', 'hi-IN').text).toMatch(/[ऀ-ॿ]/)
  })
})

describe('safety guard — prescription', () => {
  it('blocks naming an antibiotic', () => {
    expect(guard('Take some amoxicillin for the swelling.', 'en-IN').violation).toBe('prescription')
  })

  it('blocks a dosage instruction', () => {
    expect(guard('Take 500 mg twice daily until you come in.', 'en-IN').safe).toBe(false)
  })

  it('blocks an over-the-counter recommendation in Hinglish', () => {
    expect(guard('Aap Combiflam le lijiye abhi ke liye.', 'hi-Latn-IN').safe).toBe(false)
  })
})

describe('safety guard — prognosis and guarantees', () => {
  it('blocks predicting a root canal', () => {
    expect(guard('You will definitely need a root canal for this.', 'en-IN').violation).toBe(
      'prognosis',
    )
  })

  it('blocks a painlessness guarantee', () => {
    expect(guard('The procedure is completely painless, guaranteed.', 'en-IN').violation).toBe(
      'guarantee',
    )
  })
})

describe('safety guard — normal reception speech', () => {
  const ordinary = [
    'Thursday at four is free with Dr. Sharma.',
    'Scaling and polishing usually runs between fifteen hundred and twenty five hundred rupees.',
    'We are open nine to seven, Monday through Saturday.',
    'Main aapko Thursday ka slot de sakti hoon.',
    'आपकी अपॉइंटमेंट बुक हो गई है।',
    'The dentist will take a look and explain the options.',
    'Would you prefer morning or evening?',
  ]

  it('passes ordinary reception speech through untouched', () => {
    for (const text of ordinary) {
      const r = guard(text, 'en-IN')
      expect(r.safe, text).toBe(true)
      expect(r.text).toBe(text)
    }
  })
})

describe('stripStageDirections', () => {
  it('removes a parenthetical note that would otherwise be read aloud', () => {
    // Observed in a live browser call: the model emitted this and TTS spoke it.
    expect(stripStageDirections("(Waiting for the caller's response.)")).toBe('')
  })

  it('removes bracketed and asterisked notes', () => {
    expect(stripStageDirections('[pause] Thursday works. *smiles*')).toBe('Thursday works.')
  })

  it('leaves ordinary speech untouched', () => {
    const s = 'Thursday at four is free with Dr. Sharma.'
    expect(stripStageDirections(s)).toBe(s)
  })

  it('keeps the speech around a stripped note', () => {
    expect(stripStageDirections('Sure. (thinking) Let me check.')).toBe('Sure. Let me check.')
  })

  it('leaves Devanagari speech untouched', () => {
    const s = 'नमस्ते, मैं प्रिया बोल रही हूँ।'
    expect(stripStageDirections(s)).toBe(s)
  })
})

describe('narration must never be spoken (PRD §6)', () => {
  const narration = [
    'Waiting for a response.',
    "Waiting for the caller's response.",
    'I will wait for their reply.',
    'No response.',
    'Listening.',
    'The caller has not responded.',
    'Proceeding to check availability.',
  ]
  it.each(narration)('drops "%s"', (t) => expect(speakable(t)).toBe(''))

  it('keeps the reply and drops only the note that follows it', () => {
    expect(speakable('Thursday at four works. Waiting for a response.')).toBe(
      'Thursday at four works.',
    )
  })

  const real = [
    'Thursday at four is free with Dr. Sharma.',
    'Would you like me to book that?',
    'Let me check the diary for you.',
    'I will send a confirmation on WhatsApp.',
    'आपकी अपॉइंटमेंट बुक हो गई है।',
    'Main abhi dekh rahi hoon.',
  ]
  it.each(real)('keeps "%s"', (t) => expect(speakable(t)).toBe(t))
})
