import type { Lang } from '@vaani/shared'
/**
 * Hinglish → mixed-script normalisation for TTS.
 *
 * The problem this solves is specific and audible. A multilingual voice decides
 * pronunciation from the *script*, not from the language you meant. Give it
 *
 *     "Aapko Thursday subah ka slot theek rahega?"
 *
 * and every Latin token is read with English phonetics: "theek" becomes
 * "theek" (rhyming with "seek") instead of ठीक, "rahega" collapses toward
 * "ruh-HEG-uh". The result is the mangled, faintly comic accent that makes a
 * Hinglish agent unusable — while the *same voice* reads Devanagari perfectly.
 *
 * So each token is routed by the language it actually belongs to: Hindi words
 * are transliterated into Devanagari, English words are left in Latin. The
 * voice then pronounces both correctly, in one sentence, in one voice.
 *
 *     "आपको Thursday सुबह का slot ठीक रहेगा?"
 *
 * The dictionary covers conversational and dental-reception vocabulary rather
 * than attempting general transliteration: a wrong guess is worse than leaving
 * a word alone, because an unknown Latin word is usually English anyway.
 */

const HINDI_TO_DEVANAGARI: Record<string, string> = {
  // Pronouns and address
  main: 'मैं', mai: 'मैं', mein: 'में', me: 'में',
  aap: 'आप', aapko: 'आपको', aapka: 'आपका', aapki: 'आपकी', aapke: 'आपके',
  mera: 'मेरा', meri: 'मेरी', mere: 'मेरे', mujhe: 'मुझे', mujhko: 'मुझको',
  hum: 'हम', humein: 'हमें', hamara: 'हमारा', hamari: 'हमारी',
  tum: 'तुम', woh: 'वो', wo: 'वो', yeh: 'ये', ye: 'ये', iska: 'इसका', uska: 'उसका',
  koi: 'कोई', kuch: 'कुछ', sab: 'सब', sabhi: 'सभी',

  // Verbs — the load-bearing ones in service speech
  hai: 'है', hain: 'हैं', hoon: 'हूँ', hu: 'हूँ', ho: 'हो',
  tha: 'था', thi: 'थी', the: 'थे', hoga: 'होगा', hogi: 'होगी',
  karna: 'करना', karni: 'करनी', karke: 'करके', karo: 'करो', kare: 'करे',
  karta: 'करता', karti: 'करती', kar: 'कर', kiya: 'किया', ki: 'की', kijiye: 'कीजिए',
  dijiye: 'दीजिए', dena: 'देना', denge: 'देंगे', deti: 'देती', deta: 'देता',
  lijiye: 'लीजिए', lena: 'लेना', lenge: 'लेंगे',
  bataiye: 'बताइए', batana: 'बताना', bata: 'बता', bol: 'बोल', boliye: 'बोलिए',
  dekhna: 'देखना', dekhti: 'देखती', dekhta: 'देखता', dekhiye: 'देखिए', dekh: 'देख',
  aana: 'आना', aaiye: 'आइए', aayenge: 'आएँगे', aa: 'आ', jaana: 'जाना', jaiye: 'जाइए',
  milna: 'मिलना', milte: 'मिलते', milenge: 'मिलेंगे', mil: 'मिल',
  chahiye: 'चाहिए', chahta: 'चाहता', chahti: 'चाहती',
  sakta: 'सकता', sakti: 'सकती', sakte: 'सकते', sakein: 'सकें',
  raha: 'रहा', rahi: 'रही', rahe: 'रहे', rahega: 'रहेगा', rahegi: 'रहेगी',
  hota: 'होता', hoti: 'होती', hote: 'होते', gaya: 'गया', gayi: 'गई',
  samajh: 'समझ', samjha: 'समझा', samjhi: 'समझी', payi: 'पाई', paya: 'पाया',
  rakh: 'रख', rakhiye: 'रखिए', rakhte: 'रखते', bhej: 'भेज', bhejti: 'भेजती',
  laga: 'लगा', lagi: 'लगी', lag: 'लग', chal: 'चल', chalta: 'चलता',

  // Postpositions, conjunctions, particles
  ka: 'का', ke: 'के', ko: 'को', se: 'से', par: 'पर', pe: 'पे',
  aur: 'और', ya: 'या', bhi: 'भी', hi: 'ही', toh: 'तो', to: 'तो',
  agar: 'अगर', lekin: 'लेकिन', kyunki: 'क्योंकि', taaki: 'ताकि',
  liye: 'लिए', wala: 'वाला', wali: 'वाली', jaisa: 'जैसा', jaise: 'जैसे',
  nahi: 'नहीं', nahin: 'नहीं', na: 'ना', mat: 'मत',

  // Question words
  kya: 'क्या', kaun: 'कौन', kab: 'कब', kahan: 'कहाँ', kaise: 'कैसे',
  kyun: 'क्यों', kyu: 'क्यों', kitna: 'कितना', kitne: 'कितने', kitni: 'कितनी',
  konsa: 'कौनसा', konsi: 'कौनसी',

  // Courtesy and affirmation
  namaste: 'नमस्ते', namaskar: 'नमस्कार', ji: 'जी', haan: 'हाँ', han: 'हाँ',
  shukriya: 'शुक्रिया', dhanyavaad: 'धन्यवाद', maafi: 'माफ़ी', maaf: 'माफ़',
  theek: 'ठीक', thik: 'ठीक', accha: 'अच्छा', acha: 'अच्छा', bilkul: 'बिल्कुल',
  zaroor: 'ज़रूर', jarur: 'ज़रूर', arre: 'अरे', bas: 'बस',

  // Time
  aaj: 'आज', kal: 'कल', parso: 'परसों', abhi: 'अभी', phir: 'फिर',
  subah: 'सुबह', shaam: 'शाम', dopahar: 'दोपहर', raat: 'रात',
  din: 'दिन', hafta: 'हफ़्ता', hafte: 'हफ़्ते', mahina: 'महीना', saal: 'साल',
  samay: 'समय', der: 'देर', jaldi: 'जल्दी', turant: 'तुरंत', baad: 'बाद',
  pehle: 'पहले', pehli: 'पहली', ek: 'एक', do: 'दो', teen: 'तीन', char: 'चार',
  paanch: 'पाँच', minute: 'मिनट', second: 'सेकंड', ghante: 'घंटे', ghanta: 'घंटा',

  // Dental and clinic vocabulary
  daant: 'दांत', daanton: 'दांतों', dard: 'दर्द', sujan: 'सूजन', soojan: 'सूजन',
  masood: 'मसूड़ा', masoodon: 'मसूड़ों', ilaaj: 'इलाज', jaanch: 'जाँच',
  dawa: 'दवा', khoon: 'ख़ून', safai: 'सफ़ाई', saaf: 'साफ़',
  daktar: 'डॉक्टर', doctor_hi: 'डॉक्टर', sahab: 'साहब',
  paisa: 'पैसा', paise: 'पैसे', kharcha: 'ख़र्चा', rupaye: 'रुपये',

  // Misc high-frequency
  naam: 'नाम', number_hi: 'नंबर', pata: 'पता', jagah: 'जगह',
  madad: 'मदद', kaam: 'काम', baat: 'बात', cheez: 'चीज़',
  bahut: 'बहुत', bohot: 'बहुत', zyada: 'ज़्यादा', thoda: 'थोड़ा', kam: 'कम',
  matlab: 'मतलब', yaani: 'यानी', waise: 'वैसे', khaali: 'ख़ाली', khali: 'ख़ाली',
  band: 'बंद', khula: 'खुला', apna: 'अपना', apni: 'अपनी', dhyaan: 'ध्यान',
  intezaar: 'इंतज़ार', taiyaar: 'तैयार', zaroorat: 'ज़रूरत',
}

/**
 * Words that look like Hindi transliterations but are far more likely to be
 * English in this domain. Left in Latin so the voice reads them as English.
 */
const KEEP_LATIN = new Set([
  'to', 'so', 'no', 'do', 'me', 'he', 'the', 'be', 'we', 'my', 'a', 'i',
  'hi', 'is', 'in', 'on', 'at', 'or', 'am', 'an', 'as', 'by', 'up', 'it',
  'per', 'car', 'can', 'man', 'ban', 'par', 'kar', 'bar', 'far', 'hai',
])

/** Ambiguous tokens that are genuinely Hindi in this agent's speech. */
const FORCE_HINDI = new Set(['hai', 'kar', 'par', 'to'])

const HAS_DEVANAGARI = /[ऀ-ॿ]/

export interface Transliteration {
  text: string
  /** How many tokens were converted — useful for logging and tests. */
  converted: number
}

/**
 * Rewrite romanised Hindi into Devanagari, leaving English and punctuation
 * untouched. Idempotent: text already in Devanagari passes through unchanged.
 */
export function hinglishForSpeech(input: string): Transliteration {
  let converted = 0

  const text = input.replace(/[A-Za-z][A-Za-z']*/g, (token) => {
    const lower = token.toLowerCase()

    if (KEEP_LATIN.has(lower) && !FORCE_HINDI.has(lower)) return token

    const deva = HINDI_TO_DEVANAGARI[lower]
    if (!deva) return token

    converted++
    return deva
  })

  return { text, converted }
}

/**
 * Prepare text for a TTS provider, given the language the agent is speaking.
 *
 * Only Hinglish needs work: Devanagari and English are already in the script
 * whose phonetics the voice will apply.
 */
export function forSpeech(text: string, lang: Lang): string {
  // Transliteration only has meaning for the Hindi registers; every other
  // language already arrives in its own script and needs nothing done to it.
  if (lang !== 'en-IN' && lang !== 'hi-IN' && lang !== 'hi-Latn-IN') return text

  if (lang !== 'hi-Latn-IN') return text
  if (HAS_DEVANAGARI.test(text) && !/[A-Za-z]/.test(text)) return text
  return hinglishForSpeech(text).text
}
