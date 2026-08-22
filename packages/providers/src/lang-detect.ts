import { SCRIPT_RANGES, type Lang } from '@vaani/shared'

/**
 * Language detection for the register Indian callers actually speak.
 *
 * The hard case is not "Hindi or English" — it is the constant mixing:
 *
 *   "Mujhe kal morning ek appointment book karna hai."
 *   "Doctor sahab ka schedule kya hai Thursday ko?"
 *
 * Classifying that as either pure Hindi or pure English produces a reply in
 * the wrong register, which is the single most jarring thing a bilingual agent
 * can do. So Hinglish is its own label, and mixed input is detected as mixed.
 *
 * The regional languages are easy by comparison — Tamil, Telugu, Bengali,
 * Gujarati, Kannada, Malayalam and Gurmukhi each have their own Unicode block,
 * so the script settles it. The one genuine ambiguity is **Hindi and Marathi,
 * which share Devanagari**, and no amount of looking at characters separates
 * them. That is decided by a handful of words that exist in one and not the
 * other, below.
 */

/**
 * Marathi words that are not Hindi.
 *
 * Chosen from grammar rather than vocabulary — pronouns, verb endings and
 * postpositions — because a Marathi speaker discussing dentistry borrows the
 * same English nouns a Hindi speaker does, so the nouns tell you nothing.
 * "मी" (I), "तुम्ही" (you), "आहे" (is) and "-ला/-ने" case markers are Marathi
 * on sight.
 */
const MARATHI_MARKERS = [
  'मी', 'तू', 'तुम्ही', 'आम्ही', 'आहे', 'आहेत', 'आहात', 'नाही', 'होते', 'होता',
  'माझ', 'माझी', 'माझा', 'तुमच', 'तुमची', 'तुमचा', 'त्यांना', 'मला', 'तुला',
  'पाहिजे', 'करायच', 'कशी', 'कसा', 'कधी', 'कुठे', 'किती', 'का', 'आणि', 'पण',
  'उद्या', 'आज', 'सकाळी', 'संध्याकाळी', 'दुपारी', 'नमस्कार', 'धन्यवाद',
  'दात', 'दुखत', 'साफ', 'ठीक', 'बरं', 'हवं', 'हवी',
]

/** Hindi words that are not Marathi, for the same reason in reverse. */
const HINDI_DEVANAGARI_MARKERS = [
  'मैं', 'आप', 'हूँ', 'हूं', 'है', 'हैं', 'था', 'थी', 'नहीं', 'मुझे', 'आपका',
  'आपकी', 'चाहिए', 'क्या', 'कब', 'कहाँ', 'कैसे', 'कितना', 'और', 'लेकिन',
  'कल', 'आज', 'सुबह', 'शाम', 'नमस्ते', 'धन्यवाद', 'दाँत', 'दर्द', 'सफाई',
  'ठीक', 'अच्छा', 'बहुत',
]

/**
 * Which language is this Devanagari?
 *
 * Counts distinctive markers on both sides rather than stopping at the first
 * match, because a Marathi sentence can legitimately contain a word Hindi also
 * uses. Ties go to Hindi: it is far commoner, and a Marathi speaker answered in
 * Hindi is mildly annoyed, while the reverse is a stranger experience.
 */
function devanagariLanguage(text: string): { lang: Lang; confidence: number } {
  let marathi = 0
  let hindi = 0
  for (const m of MARATHI_MARKERS) if (text.includes(m)) marathi++
  for (const m of HINDI_DEVANAGARI_MARKERS) if (text.includes(m)) hindi++

  if (marathi > hindi) {
    return { lang: 'mr-IN', confidence: Math.min(0.97, 0.8 + marathi * 0.04) }
  }
  return { lang: 'hi-IN', confidence: hindi > 0 ? Math.min(0.99, 0.85 + hindi * 0.03) : 0.8 }
}

/**
 * Languages whose script is theirs alone.
 *
 * Order does not matter — the blocks do not overlap — so the first match is the
 * answer and there is nothing to disambiguate.
 */
const UNAMBIGUOUS_SCRIPTS: Array<[Lang, RegExp]> = [
  ['gu-IN', SCRIPT_RANGES.gujarati],
  ['bn-IN', SCRIPT_RANGES.bengali],
  ['ta-IN', SCRIPT_RANGES.tamil],
  ['te-IN', SCRIPT_RANGES.telugu],
  ['kn-IN', SCRIPT_RANGES.kannada],
  ['ml-IN', SCRIPT_RANGES.malayalam],
  ['pa-IN', SCRIPT_RANGES.gurmukhi],
]

/**
 * High-frequency romanised Hindi function words — grammar, not vocabulary.
 *
 * Deliberately excludes `to`, `me`, and `the`: each is a real romanised Hindi
 * word ("toh", "mein", "the" = were) that is spelled identically to a very
 * common English word. Counting them makes ordinary English sentences score as
 * Hindi, which is far worse than missing a weak signal.
 */
const HINDI_MARKERS = new Set([
  'hai', 'hain', 'ho', 'hoon', 'tha', 'thi', 'ka', 'ke', 'ki', 'ko', 'se',
  'mein', 'par', 'pe', 'aur', 'ya', 'nahi', 'nahin', 'haan', 'ji',
  'mujhe', 'mera', 'meri', 'mere', 'aap', 'aapka', 'aapki', 'tum', 'main',
  'kya', 'kaun', 'kab', 'kahan', 'kaise', 'kyun', 'kitna', 'kitne', 'kuch',
  'karna', 'karni', 'karo', 'kare', 'karta', 'karti', 'chahiye', 'sakta',
  'sakti', 'raha', 'rahi', 'rahe', 'liye', 'wala', 'wali', 'bhi', 'toh',
  'abhi', 'kal', 'aaj', 'parso', 'subah', 'shaam', 'raat', 'dopahar',
  'accha', 'theek', 'thik', 'bahut', 'zyada', 'jaldi', 'dard', 'sahab',
])

/** Common English function words — the mirror-image grammatical signal. */
const ENGLISH_MARKERS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'have', 'has', 'do', 'does',
  'i', 'you', 'my', 'your', 'me', 'we', 'it', 'and', 'or', 'but', 'for', 'to',
  'of', 'in', 'on', 'at', 'with', 'want', 'need', 'can', 'could', 'would',
  'please', 'thanks', 'thank', 'yes', 'no', 'what', 'when', 'where', 'how',
])

/**
 * English content words common in this domain.
 *
 * Function words alone cannot detect Hinglish, because Hinglish keeps Hindi
 * grammar and borrows English *nouns*: "Mujhe kal morning appointment book
 * karna hai" contains no English function words at all, yet is unmistakably
 * code-switched. These borrowings are the English signal in that register.
 */
const ENGLISH_CONTENT = new Set([
  'appointment', 'appointments', 'book', 'booking', 'cancel', 'confirm',
  'reschedule', 'doctor', 'dentist', 'clinic', 'checkup', 'cleaning',
  'filling', 'crown', 'braces', 'extraction', 'surgery', 'scaling',
  'insurance', 'policy', 'payment', 'cash', 'card', 'report', 'xray',
  'morning', 'evening', 'afternoon', 'night', 'today', 'tomorrow', 'time',
  'slot', 'schedule', 'available', 'free', 'pain', 'tooth', 'teeth', 'gums',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'emergency', 'urgent', 'address', 'location', 'number', 'name', 'ok', 'okay',
])

const DEVANAGARI = /[ऀ-ॿ]/

export interface DetectionResult {
  lang: Lang
  confidence: number
  codeSwitched: boolean
}

/**
 * Detect the language of a transcript.
 *
 * @param text  the transcript
 * @param hint  the language the STT provider reported, if any
 */
export function detectLang(text: string, hint?: Lang): DetectionResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { lang: hint ?? 'en-IN', confidence: 0, codeSwitched: false }
  }

  const latinChars = (trimmed.match(/[A-Za-z]/g) ?? []).length

  // A script that belongs to exactly one language settles it outright.
  for (const [lang, range] of UNAMBIGUOUS_SCRIPTS) {
    if (range.test(trimmed)) {
      return { lang, confidence: 0.99, codeSwitched: latinChars > 0 }
    }
  }

  // Devanagari narrows it to two, and the words decide which.
  const devanagariChars = (trimmed.match(SCRIPT_RANGES.devanagari) ?? []).length
  if (devanagariChars > 0) {
    const { lang, confidence } = devanagariLanguage(trimmed)
    // Both scripts in one utterance is code-switching by definition.
    return { lang, confidence: latinChars > 0 ? confidence - 0.05 : confidence, codeSwitched: latinChars > 0 }
  }

  const words = trimmed.toLowerCase().split(/[^a-z']+/).filter(Boolean)
  if (words.length === 0) {
    return { lang: hint ?? 'en-IN', confidence: 0.3, codeSwitched: false }
  }

  let hindi = 0
  let english = 0
  for (const w of words) {
    if (HINDI_MARKERS.has(w)) hindi++
    if (ENGLISH_MARKERS.has(w) || ENGLISH_CONTENT.has(w)) english++
  }

  const signal = hindi + english
  if (signal === 0) {
    // No recognisable marker at all — usually a bare noun phrase ("root canal").
    // Keep whatever language the conversation was already in rather than guess.
    return { lang: hint ?? 'en-IN', confidence: 0.35, codeSwitched: false }
  }

  const confidence = 0.8 + Math.min(0.15, signal / 20)
  const codeSwitched = hindi > 0 && english > 0

  // Hindi grammar anywhere in the utterance decides the register — a Hindi
  // speaker borrowing English nouns is speaking Hinglish, not English.
  if (hindi > 0) {
    return { lang: 'hi-Latn-IN', confidence: codeSwitched ? confidence - 0.05 : confidence, codeSwitched }
  }
  return { lang: 'en-IN', confidence, codeSwitched: false }
}

/** True when the string contains any Devanagari. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text)
}

/**
 * A language the caller has asked for by name.
 *
 * Detection answers "what is this sentence written in", which is the wrong
 * question when the sentence is "Punjabi mein baat kar sakte hain?" — that is
 * Hindi, and answering it in Hindi is precisely what the caller did not ask
 * for. The request outranks the medium it arrived in.
 *
 * Only acts when exactly one language is named. "I speak Hindi at home, but
 * English is fine" names two, and guessing between them is worse than falling
 * back to reading the sentence itself.
 */
/**
 * Stems, not citation forms.
 *
 * These languages inflect the language's own name: Tamil for "in Tamil" is
 * "தமிழில்", which does not contain "தமிழ்" — the final pulli is replaced by the
 * case ending. Matching the bare stem catches both.
 */
const LANGUAGE_NAMED: Record<Lang, RegExp> = {
  'en-IN': /\b(english|angrezi|angreji)\b|अंग्रे[ज़]?ी|इंग्लिश|ਅੰਗਰੇਜ਼ੀ|ஆங்கில|ఇంగ్లీష్|ಇಂಗ್ಲಿಷ್|ഇംഗ്ലീഷ|ইংরেজি|અંગ્રેજી/i,
  'hi-IN': /\bhindi\b|हिंदी|हिन्दी|ਹਿੰਦੀ|இந்தி|హిందీ|ಹಿಂದಿ|ഹിന്ദി|হিন্দি|હિન્દી/i,
  'hi-Latn-IN': /\bhinglish\b/i,
  'mr-IN': /\bmarathi\b|मराठी|ਮਰਾਠੀ|மராத்தி|మరాఠీ|ಮರಾಠಿ|മറാത്തി|মারাঠি|મરાઠી/i,
  'gu-IN': /\bgujarati\b|गुजराती|ગુજરાતી|ਗੁਜਰਾਤੀ|குஜராத்தி|గుజరాతీ|ಗುಜರಾತಿ|ഗുജറാത്തി|গুজরাটি/i,
  'bn-IN': /\b(bengali|bangla)\b|बंगाली|बांग्ला|বাংলা|ਬੰਗਾਲੀ|வங்காள|బెంగాలీ|ಬಂಗಾಳಿ|ബംഗാളി/i,
  'ta-IN': /\btamil\b|तमिल|तमिळ|தமிழ|ਤਮਿਲ|తమిళ్|ತಮಿಳು|തമിഴ്|তামিল|તમિલ/i,
  'te-IN': /\btelugu\b|तेलुगु|తెలుగు|ਤੇਲਗੂ|தெலுங்க|ತೆಲುಗು|തെലുങ്ക്|তেলুগু|તેલુગુ/i,
  'kn-IN': /\bkannada\b|कन्नड़|कन्नड|ಕನ್ನಡ|ਕੰਨੜ|கன்னட|కన్నడ|കന്നഡ|কন্নড়|કન્નડ/i,
  'ml-IN': /\bmalayalam\b|मलयालम|മലയാള|ਮਲਿਆਲਮ|மலையாளம்|మలయాళం|ಮಲಯಾಳಂ|মালয়ালম|મલયાલમ/i,
  'pa-IN': /\b(punjabi|panjabi)\b|पंजाबी|ਪੰਜਾਬੀ|பஞ்சாபி|పంజాబీ|ಪಂಜಾಬಿ|പഞ്ചാബി|পাঞ্জাবি|પંજાબી/i,
}

export function requestedLang(text: string): Lang | null {
  const named = (Object.keys(LANGUAGE_NAMED) as Lang[]).filter((l) =>
    LANGUAGE_NAMED[l].test(text),
  )
  // Hinglish names itself with "Hinglish"; the word also contains no "hindi",
  // so the two never collide.
  return named.length === 1 ? named[0]! : null
}
