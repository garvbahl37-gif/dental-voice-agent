import type { Lang } from '@vaani/shared'

/**
 * Clinical safety guard — the last line before audio.
 *
 * Three independent layers protect against the agent practising dentistry:
 * system-prompt rails, `triage_symptoms` owning all urgency decisions, and
 * this function, which inspects every outgoing utterance.
 *
 * Layers one and two are instructions to a model, and a model can be talked
 * out of an instruction. This layer cannot: it is a rule applied after
 * generation and before synthesis, so a violation never reaches the caller
 * even if the prompt was successfully subverted.
 */

export type Violation = 'diagnosis' | 'prescription' | 'prognosis' | 'guarantee'

interface Rule {
  kind: Violation
  patterns: RegExp[]
}

const RULES: Rule[] = [
  {
    kind: 'diagnosis',
    patterns: [
      /\byou\s+(have|'ve got|likely have|probably have|definitely have)\s+(an?\s+)?(abscess|cavity|caries|infection|gingivitis|periodontitis|pulpitis|cyst|tumou?r)/i,
      /\b(this|that|it)\s+is\s+(definitely|certainly|clearly)\s+(an?\s+)?(abscess|infection|cavity|decay)/i,
      /\bi\s+(can\s+)?diagnos/i,
      /\baapko\s+.*(infection|abscess|cavity)\s+hai\b/i,
      /आपको\s+.*(इन्फेक्शन|संक्रमण|कैविटी)\s+है/,
    ],
  },
  {
    kind: 'prescription',
    patterns: [
      // Naming a specific drug is a violation regardless of the surrounding
      // sentence. A receptionist has no business putting a drug name in the
      // caller's head, whether phrased as advice, a question, or an aside.
      /\b(amoxicillin|augmentin|metrogyl|metronidazole|ibuprofen|brufen|combiflam|paracetamol|crocin|dolo\s?650|ketorol|zerodol|ciplox|azithromycin)\b/i,
      /\b(take|start|use)\s+(some\s+)?antibiotics?\b/i,
      /\b\d+\s*mg\b.*\b(twice|thrice|daily|a day|per day)\b/i,
      /\bi\s+(can\s+)?prescri/i,
      /\b(le\s+lijiye|kha\s+lijiye|le\s+lena)\b.*\b(tablet|dawa|medicine|antibiotic)/i,
      /(दवा|टैबलेट|एंटीबायोटिक)\s+.*(ले\s*ली?जिए|खा\s*लीजिए)/,
    ],
  },
  {
    kind: 'prognosis',
    patterns: [
      /\byou\s+(will|'ll)\s+(definitely\s+)?(need|require)\s+(a\s+)?(root canal|extraction|surgery|implant)/i,
      /\b(you\s+)?(will|'ll)\s+lose\s+(the\s+|that\s+|your\s+)?tooth\b/i,
      /\baapka\s+daant\s+.*(nikalna|nikalna hi)\s+pad(ega|egi)/i,
    ],
  },
  {
    kind: 'guarantee',
    patterns: [
      /\b(guarantee|guaranteed|100%\s+(safe|success)|no\s+risk|completely\s+painless)\b/i,
      /\bbilkul\s+(safe|dard\s+nahi)\b/i,
    ],
  },
]

/** Safe replacements, per violation and language. */
const DEFERRALS: Record<Violation, Record<Lang, string>> = {
  diagnosis: {
    'en-IN':
      "I'm not able to say what's causing it — that's really for the dentist to look at. What I can do is get you in to see them.",
    'hi-IN':
      'मैं यह नहीं बता सकती कि इसकी वजह क्या है — यह डॉक्टर ही देखकर बता पाएंगे। मैं आपको उनसे मिलवा सकती हूँ।',
    'hi-Latn-IN':
      'Main yeh nahi bata sakti ki iski wajah kya hai — yeh doctor hi dekh kar bata payenge. Main aapko unse milwa sakti hoon.',
  },
  prescription: {
    'en-IN':
      "I can't advise on any medication — the dentist will decide that after examining you. Let me get you an appointment.",
    'hi-IN':
      'मैं किसी दवा के बारे में सलाह नहीं दे सकती — डॉक्टर जांच के बाद तय करेंगे। मैं अपॉइंटमेंट लगा देती हूँ।',
    'hi-Latn-IN':
      'Main kisi dawa ke baare mein advice nahi de sakti — doctor jaanch ke baad decide karenge. Main appointment laga deti hoon.',
  },
  prognosis: {
    'en-IN':
      "I wouldn't want to guess at the treatment — the dentist will talk you through the options once they've had a look.",
    'hi-IN':
      'मैं इलाज के बारे में अंदाज़ा नहीं लगाना चाहूँगी — डॉक्टर देखने के बाद आपको सारे विकल्प समझाएंगे।',
    'hi-Latn-IN':
      'Main treatment ke baare mein guess nahi karna chahungi — doctor dekhne ke baad aapko saare options samjhayenge.',
  },
  guarantee: {
    'en-IN': "The dentist will go through what to expect with you at the appointment.",
    'hi-IN': 'डॉक्टर अपॉइंटमेंट में आपको सब कुछ विस्तार से समझा देंगे।',
    'hi-Latn-IN': 'Doctor appointment mein aapko sab kuch detail mein samjha denge.',
  },
}

/**
 * Strip anything that is a note rather than speech.
 *
 * Models sometimes emit "(Waiting for the caller's response.)" or "[pause]".
 * In a chat window that is harmless; here every character reaches TTS and is
 * read aloud, brackets included.
 */
/**
 * Narration the model addresses to itself rather than to the caller.
 *
 * "Waiting for a response." has no brackets to strip, so the bracket filter
 * misses it entirely — and it is read aloud. These are sentences whose subject
 * is the agent's own process: it is describing the conversation instead of
 * having it.
 */
const NARRATION: RegExp[] = [
  /^\s*(now\s+)?waiting for (the |their |your |a )?(caller|response|reply|answer|user)/i,
  /^\s*i(\'ll| will)? (now |just )?wait( for)?/i,
  /^\s*(let me|i(\'ll| will)) (think|process|consider) (about )?that\.?\s*$/i,
  /^\s*(no response|silence|pause|awaiting|listening)\.?\s*$/i,
  /^\s*(the )?(caller|user) (has not|hasn\'t|did not|didn\'t) (responded|replied|answered)/i,
  /^\s*(end of|continuing|resuming) (turn|conversation|call)/i,
  /^\s*i(\'m| am) (now )?(listening|waiting|thinking)\.?\s*$/i,
  /^\s*proceeding to/i,
  /^\s*(calling|invoking|executing) [a-z_]+\(/i,
]

/** Is this whole utterance the agent narrating itself? */
export function isNarration(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return false
  return NARRATION.some((p) => p.test(t))
}

export function stripStageDirections(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Everything that must not be spoken, in one pass.
 *
 * Returns an empty string when nothing survives — the caller hears silence,
 * which is better than hearing the machine describe itself.
 */
export function speakable(text: string): string {
  const stripped = stripStageDirections(text)
  if (stripped.length === 0) return ''
  // Drop narration sentence by sentence: a good reply followed by a note to
  // self should lose only the note.
  const kept = stripped
    .split(/(?<=[.!?।])\s+/)
    .filter((sentence) => !isNarration(sentence))
    .join(' ')
    .trim()
  return kept
}

export interface GuardResult {
  safe: boolean
  violation?: Violation
  /** What should actually be spoken. Equals the input when safe. */
  text: string
}

export function guard(text: string, lang: Lang): GuardResult {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { safe: false, violation: rule.kind, text: DEFERRALS[rule.kind][lang] }
    }
  }
  return { safe: true, text }
}
