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

/**
 * Safe replacements, per violation and language.
 *
 * Written in every language the agent speaks, not translated at runtime and not
 * left to fall back to English. This is the sentence a caller hears at the exact
 * moment the guard stops the agent saying something clinical — dropping into
 * English there tells them something has gone wrong, on the one turn where
 * being reassuring and clear matters most.
 *
 * Each says the same three things: I cannot answer that, the dentist decides it,
 * here is what I *can* do.
 */
const DEFERRALS: Record<Violation, Record<Lang, string>> = {
  diagnosis: {
    'en-IN':
      "I'm not able to say what's causing it — that's really for the dentist to look at. What I can do is get you in to see them.",
    'hi-IN':
      'मैं यह नहीं बता सकती कि इसकी वजह क्या है — यह डॉक्टर ही देखकर बता पाएंगे। मैं आपको उनसे मिलवा सकती हूँ।',
    'hi-Latn-IN':
      'Main yeh nahi bata sakti ki iski wajah kya hai — yeh doctor hi dekh kar bata payenge. Main aapko unse milwa sakti hoon.',
    'mr-IN':
      'याचं कारण काय आहे हे मी सांगू शकत नाही — ते डॉक्टरच तपासून सांगतील. मी तुमची भेट ठरवून देते.',
    'gu-IN':
      'આનું કારણ શું છે એ હું કહી શકતી નથી — ડૉક્ટર તપાસીને જ કહી શકશે. હું તમારી એપોઇન્ટમેન્ટ ગોઠવી આપું.',
    'bn-IN':
      'এর কারণ কী তা আমি বলতে পারব না — ডাক্তারই দেখে বলতে পারবেন। আমি আপনার অ্যাপয়েন্টমেন্ট করে দিচ্ছি।',
    'ta-IN':
      'இதற்கான காரணத்தை என்னால் சொல்ல முடியாது — மருத்துவர் பார்த்துத்தான் சொல்ல முடியும். நான் உங்களுக்கு அப்பாயின்ட்மென்ட் ஏற்பாடு செய்கிறேன்.',
    'te-IN':
      'దీనికి కారణం ఏమిటో నేను చెప్పలేను — డాక్టర్ చూసి మాత్రమే చెప్పగలరు. నేను మీకు అపాయింట్‌మెంట్ ఏర్పాటు చేస్తాను.',
    'kn-IN':
      'ಇದಕ್ಕೆ ಕಾರಣವೇನೆಂದು ನಾನು ಹೇಳಲಾರೆ — ವೈದ್ಯರು ನೋಡಿಯೇ ಹೇಳಬಲ್ಲರು. ನಾನು ನಿಮಗೆ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮಾಡಿಕೊಡುತ್ತೇನೆ.',
    'ml-IN':
      'ഇതിന്റെ കാരണം എനിക്ക് പറയാൻ കഴിയില്ല — ഡോക്ടർ പരിശോധിച്ചിട്ടേ പറയാൻ പറ്റൂ. ഞാൻ അപ്പോയിന്റ്മെന്റ് ശരിയാക്കാം.',
    'pa-IN':
      'ਇਸ ਦਾ ਕਾਰਨ ਕੀ ਹੈ ਮੈਂ ਨਹੀਂ ਦੱਸ ਸਕਦੀ — ਡਾਕਟਰ ਹੀ ਵੇਖ ਕੇ ਦੱਸ ਸਕਣਗੇ। ਮੈਂ ਤੁਹਾਡੀ ਅਪਾਇੰਟਮੈਂਟ ਲਗਾ ਦਿੰਦੀ ਹਾਂ।',
  },
  prescription: {
    'en-IN':
      "I can't advise on any medication — the dentist will decide that after examining you. Let me get you an appointment.",
    'hi-IN':
      'मैं किसी दवा के बारे में सलाह नहीं दे सकती — डॉक्टर जांच के बाद तय करेंगे। मैं अपॉइंटमेंट लगा देती हूँ।',
    'hi-Latn-IN':
      'Main kisi dawa ke baare mein advice nahi de sakti — doctor jaanch ke baad decide karenge. Main appointment laga deti hoon.',
    'mr-IN':
      'मी कोणत्याही औषधाबद्दल सल्ला देऊ शकत नाही — डॉक्टर तपासणीनंतर ठरवतील. मी अपॉइंटमेंट लावून देते.',
    'gu-IN':
      'હું કોઈ દવા વિશે સલાહ આપી શકતી નથી — ડૉક્ટર તપાસ પછી નક્કી કરશે. હું એપોઇન્ટમેન્ટ ગોઠવી આપું.',
    'bn-IN':
      'আমি কোনও ওষুধের পরামর্শ দিতে পারি না — ডাক্তার পরীক্ষা করে ঠিক করবেন। আমি অ্যাপয়েন্টমেন্ট করে দিচ্ছি।',
    'ta-IN':
      'எந்த மருந்தையும் பற்றி என்னால் ஆலோசனை சொல்ல முடியாது — மருத்துவர் பரிசோதித்த பிறகு முடிவு செய்வார். நான் அப்பாயின்ட்மென்ட் ஏற்பாடு செய்கிறேன்.',
    'te-IN':
      'ఏ మందు గురించీ నేను సలహా ఇవ్వలేను — డాక్టర్ పరీక్షించిన తర్వాత నిర్ణయిస్తారు. నేను అపాయింట్‌మెంట్ ఏర్పాటు చేస్తాను.',
    'kn-IN':
      'ಯಾವುದೇ ಔಷಧಿಯ ಬಗ್ಗೆ ನಾನು ಸಲಹೆ ನೀಡಲಾರೆ — ವೈದ್ಯರು ಪರೀಕ್ಷಿಸಿದ ನಂತರ ನಿರ್ಧರಿಸುತ್ತಾರೆ. ನಾನು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮಾಡಿಕೊಡುತ್ತೇನೆ.',
    'ml-IN':
      'ഒരു മരുന്നിനെക്കുറിച്ചും എനിക്ക് ഉപദേശിക്കാൻ കഴിയില്ല — ഡോക്ടർ പരിശോധിച്ച ശേഷം തീരുമാനിക്കും. ഞാൻ അപ്പോയിന്റ്മെന്റ് ശരിയാക്കാം.',
    'pa-IN':
      'ਮੈਂ ਕਿਸੇ ਦਵਾਈ ਬਾਰੇ ਸਲਾਹ ਨਹੀਂ ਦੇ ਸਕਦੀ — ਡਾਕਟਰ ਜਾਂਚ ਤੋਂ ਬਾਅਦ ਫੈਸਲਾ ਕਰਨਗੇ। ਮੈਂ ਅਪਾਇੰਟਮੈਂਟ ਲਗਾ ਦਿੰਦੀ ਹਾਂ।',
  },
  prognosis: {
    'en-IN':
      "I wouldn't want to guess at the treatment — the dentist will talk you through the options once they've had a look.",
    'hi-IN':
      'मैं इलाज के बारे में अंदाज़ा नहीं लगाना चाहूँगी — डॉक्टर देखने के बाद आपको सारे विकल्प समझाएंगे।',
    'hi-Latn-IN':
      'Main treatment ke baare mein guess nahi karna chahungi — doctor dekhne ke baad aapko saare options samjhayenge.',
    'mr-IN':
      'उपचाराबद्दल मी अंदाज लावू इच्छित नाही — डॉक्टर तपासल्यावर तुम्हाला सर्व पर्याय समजावून सांगतील.',
    'gu-IN':
      'સારવાર વિશે હું અનુમાન કરવા માંગતી નથી — ડૉક્ટર તપાસ્યા પછી તમને બધા વિકલ્પો સમજાવશે.',
    'bn-IN':
      'চিকিৎসা নিয়ে আমি অনুমান করতে চাই না — ডাক্তার দেখার পর আপনাকে সব বিকল্প বুঝিয়ে বলবেন।',
    'ta-IN':
      'சிகிச்சை பற்றி நான் ஊகிக்க விரும்பவில்லை — மருத்துவர் பார்த்த பிறகு அனைத்து வழிகளையும் விளக்குவார்.',
    'te-IN':
      'చికిత్స గురించి నేను ఊహించదలచుకోలేదు — డాక్టర్ చూసిన తర్వాత అన్ని మార్గాలను వివరిస్తారు.',
    'kn-IN':
      'ಚಿಕಿತ್ಸೆಯ ಬಗ್ಗೆ ನಾನು ಊಹಿಸಲು ಬಯಸುವುದಿಲ್ಲ — ವೈದ್ಯರು ನೋಡಿದ ನಂತರ ಎಲ್ಲಾ ಆಯ್ಕೆಗಳನ್ನು ವಿವರಿಸುತ್ತಾರೆ.',
    'ml-IN':
      'ചികിത്സയെക്കുറിച്ച് ഞാൻ ഊഹിക്കാൻ ആഗ്രഹിക്കുന്നില്ല — ഡോക്ടർ പരിശോധിച്ച ശേഷം എല്ലാ വഴികളും വിശദീകരിക്കും.',
    'pa-IN':
      'ਇਲਾਜ ਬਾਰੇ ਮੈਂ ਅੰਦਾਜ਼ਾ ਨਹੀਂ ਲਗਾਉਣਾ ਚਾਹੁੰਦੀ — ਡਾਕਟਰ ਵੇਖਣ ਤੋਂ ਬਾਅਦ ਤੁਹਾਨੂੰ ਸਾਰੇ ਵਿਕਲਪ ਸਮਝਾਉਣਗੇ।',
  },
  guarantee: {
    'en-IN': "The dentist will go through what to expect with you at the appointment.",
    'hi-IN': 'डॉक्टर अपॉइंटमेंट में आपको सब कुछ विस्तार से समझा देंगे।',
    'hi-Latn-IN': 'Doctor appointment mein aapko sab kuch detail mein samjha denge.',
    'mr-IN': 'डॉक्टर अपॉइंटमेंटमध्ये तुम्हाला सगळं सविस्तर समजावून सांगतील.',
    'gu-IN': 'ડૉક્ટર એપોઇન્ટમેન્ટમાં તમને બધું વિગતવાર સમજાવશે.',
    'bn-IN': 'ডাক্তার অ্যাপয়েন্টমেন্টে আপনাকে সবকিছু বিস্তারিত বুঝিয়ে দেবেন।',
    'ta-IN': 'மருத்துவர் அப்பாயின்ட்மென்ட்டில் உங்களுக்கு எல்லாவற்றையும் விளக்குவார்.',
    'te-IN': 'డాక్టర్ అపాయింట్‌మెంట్‌లో మీకు అన్నీ వివరంగా చెబుతారు.',
    'kn-IN': 'ವೈದ್ಯರು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ನಲ್ಲಿ ನಿಮಗೆ ಎಲ್ಲವನ್ನೂ ವಿವರವಾಗಿ ತಿಳಿಸುತ್ತಾರೆ.',
    'ml-IN': 'ഡോക്ടർ അപ്പോയിന്റ്മെന്റിൽ എല്ലാം വിശദമായി പറഞ്ഞുതരും.',
    'pa-IN': 'ਡਾਕਟਰ ਅਪਾਇੰਟਮੈਂਟ ਵਿੱਚ ਤੁਹਾਨੂੰ ਸਭ ਕੁਝ ਵਿਸਥਾਰ ਨਾਲ ਸਮਝਾਉਣਗੇ।',
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
