import type { Lang } from '@vaani/shared'

/**
 * Dental emergency triage.
 *
 * This is the one part of the product with a real human cost when it is wrong,
 * so urgency is decided by rules — not by the model. The model's only job is
 * to report symptoms; this function decides the band and returns the script
 * that must be said.
 *
 * An avulsed (knocked-out) permanent tooth has roughly a 30-minute
 * re-implantation window. A model that responds conversationally to that
 * instead of escalating immediately has caused harm. Hence: hard-coded.
 */

export type TriageBand = 'red' | 'amber' | 'green'

export interface TriageResult {
  band: TriageBand
  reason: string
  /** Exact words the agent must say. Not a suggestion to paraphrase. */
  script: Record<Lang, string>
  /** Whether to alert the practice out-of-band immediately. */
  alertPractice: boolean
  /** Preferred slot horizon in days. */
  bookWithinDays: number
}

interface Rule {
  band: TriageBand
  reason: string
  patterns: RegExp[]
  alertPractice: boolean
  bookWithinDays: number
}

/**
 * RED conditions. Airway, uncontrolled bleeding, spreading infection, and
 * avulsion — the cases where minutes matter and a dental chair is the wrong
 * destination.
 */
const RULES: Rule[] = [
  {
    band: 'red',
    reason: 'Possible airway compromise or spreading facial infection',
    alertPractice: true,
    bookWithinDays: 0,
    patterns: [
      /difficult(y)?\s+(in\s+)?(breath|swallow)/i,
      /can(no|')?t\s+(breathe|swallow|open my mouth)/i,
      /swelling\s+(near|around|under)\s+(my\s+)?(eye|throat|neck|jaw)/i,
      /face\s+(is\s+)?swollen/i,
      /saans\s+(nahi|nhi|lene)/i,
      /nigal\s+nahi/i,
      /(gala|chehra|aankh)\s+.*(sooj|soojan)/i,
      /सांस|निगल|सूजन.*(आँख|गला)/,
      /fever\s+with\s+(swelling|face)/i,
    ],
  },
  {
    band: 'red',
    reason: 'Avulsed tooth — re-implantation window is roughly 30 minutes',
    alertPractice: true,
    bookWithinDays: 0,
    patterns: [
      /knocked\s+out/i,
      /tooth\s+(came|fell)\s+out\s+(completely|fully)/i,
      /(poora|pura)\s+daant\s+(nikal|toot)/i,
      /दांत\s+(पूरा\s+)?(निकल|टूट)\s*गया/,
      /avuls/i,
    ],
  },
  {
    band: 'red',
    reason: 'Uncontrolled bleeding',
    alertPractice: true,
    bookWithinDays: 0,
    patterns: [
      /bleeding\s+(wo|will)n.t\s+stop/i,
      /can(no|')?t\s+stop\s+.*bleed/i,
      /(khoon|blood)\s+.*(band nahi|ruk nahi)/i,
      /खून\s+.*(बंद नहीं|रुक नहीं)/,
    ],
  },
  {
    band: 'red',
    reason: 'Facial trauma',
    alertPractice: true,
    bookWithinDays: 0,
    patterns: [/jaw\s+(is\s+)?(broken|fractur)/i, /accident.*(mouth|jaw|teeth)/i, /jabda\s+toot/i],
  },
  {
    band: 'amber',
    reason: 'Severe pain or probable abscess — needs same or next day',
    alertPractice: false,
    bookWithinDays: 1,
    patterns: [
      /severe\s+pain/i,
      /unbearable|excruciating/i,
      /pain\s+(is\s+)?(10|nine|ten)\s*(\/|out of)/i,
      /abscess|pus|boil/i,
      /can(no|')?t\s+sleep\s+.*pain/i,
      /(bahut|bohot)\s+(zyada\s+)?dard/i,
      /dard\s+.*(so nahi|bardaash)/i,
      /(बहुत|तेज़)\s+दर्द|मवाद/,
      /swelling\s+(in|on)\s+(my\s+)?gum/i,
    ],
  },
  {
    band: 'amber',
    reason: 'Broken tooth with pain, or lost restoration',
    alertPractice: false,
    bookWithinDays: 2,
    patterns: [
      /(broke|chipped|cracked)\s+.*(tooth|teeth)/i,
      /crown\s+(came|fell)\s+off/i,
      /filling\s+(came|fell)\s+out/i,
      /daant\s+(toot|tut)/i,
      /दांत\s+टूट/,
    ],
  },
]

/**
 * What the caller is told, per band and language.
 *
 * The highest-stakes text in the system, so it is written out in every language
 * rather than translated at runtime or allowed to fall back. Someone being told
 * to go to an emergency room must hear it in the language they rang in — that
 * is the one sentence where comprehension is not a nicety.
 */
const SCRIPTS: Record<TriageBand, Record<Lang, string>> = {
  red: {
    'en-IN':
      'I need to stop you there — what you are describing needs urgent medical attention, and it should not wait for a dental appointment. Please go to your nearest emergency room right away. I am alerting the clinic now, and our on-call dentist will call you within a few minutes.',
    'hi-IN':
      'मैं आपको यहीं रोकूँगी — जो आप बता रहे हैं उसमें तुरंत मेडिकल ध्यान चाहिए, यह अपॉइंटमेंट का इंतज़ार नहीं कर सकता। कृपया अभी अपने नज़दीकी इमरजेंसी रूम जाइए। मैं क्लिनिक को सूचित कर रही हूँ, हमारे ऑन-कॉल डॉक्टर कुछ ही मिनट में आपको कॉल करेंगे।',
    'hi-Latn-IN':
      'Main aapko yahin rokungi — jo aap bata rahe hain usme turant medical attention chahiye, yeh appointment ka wait nahi kar sakta. Please abhi nazdeeki emergency room jaiye. Main clinic ko alert kar rahi hoon, hamare on-call doctor kuch hi minute mein aapko call karenge.',
    'mr-IN':
      'मी तुम्हाला इथेच थांबवते — तुम्ही जे सांगत आहात त्यासाठी तातडीने वैद्यकीय मदत हवी, ते अपॉइंटमेंटची वाट पाहू शकत नाही. कृपया लगेच जवळच्या इमर्जन्सी रूममध्ये जा. मी क्लिनिकला कळवते आहे, आमचे ऑन-कॉल डॉक्टर काही मिनिटांत तुम्हाला फोन करतील.',
    'gu-IN':
      'હું તમને અહીં જ રોકું છું — તમે જે કહી રહ્યા છો તેમાં તાત્કાલિક તબીબી સારવાર જોઈએ, એ એપોઇન્ટમેન્ટની રાહ જોઈ શકે નહીં. કૃપા કરીને હમણાં જ નજીકના ઇમરજન્સી રૂમમાં જાઓ. હું ક્લિનિકને જાણ કરું છું, અમારા ઓન-કૉલ ડૉક્ટર થોડી જ મિનિટોમાં તમને ફોન કરશે.',
    'bn-IN':
      'আমি এখানেই থামাচ্ছি — আপনি যা বলছেন তাতে এখনই চিকিৎসা দরকার, এটা অ্যাপয়েন্টমেন্টের জন্য অপেক্ষা করতে পারে না। দয়া করে এখনই নিকটতম ইমার্জেন্সিতে যান। আমি ক্লিনিককে জানাচ্ছি, আমাদের অন-কল ডাক্তার কয়েক মিনিটের মধ্যে আপনাকে ফোন করবেন।',
    'ta-IN':
      'நான் இங்கேயே நிறுத்துகிறேன் — நீங்கள் சொல்வதற்கு உடனடி மருத்துவ கவனிப்பு தேவை, அது அப்பாயின்ட்மென்ட்டுக்காக காத்திருக்க முடியாது. தயவுசெய்து இப்போதே அருகிலுள்ள அவசர சிகிச்சைப் பிரிவுக்குச் செல்லுங்கள். நான் கிளினிக்கிற்குத் தெரிவிக்கிறேன், எங்கள் ஆன்-கால் மருத்துவர் சில நிமிடங்களில் உங்களை அழைப்பார்.',
    'te-IN':
      'నేను ఇక్కడే ఆపుతున్నాను — మీరు చెబుతున్నదానికి వెంటనే వైద్య సహాయం కావాలి, అది అపాయింట్‌మెంట్ కోసం ఆగలేదు. దయచేసి ఇప్పుడే దగ్గరి ఎమర్జెన్సీ రూమ్‌కి వెళ్లండి. నేను క్లినిక్‌కి తెలియజేస్తున్నాను, మా ఆన్-కాల్ డాక్టర్ కొద్ది నిమిషాల్లో మీకు ఫోన్ చేస్తారు.',
    'kn-IN':
      'ನಾನು ಇಲ್ಲಿಯೇ ನಿಲ್ಲಿಸುತ್ತೇನೆ — ನೀವು ಹೇಳುತ್ತಿರುವುದಕ್ಕೆ ತಕ್ಷಣ ವೈದ್ಯಕೀಯ ನೆರವು ಬೇಕು, ಅದು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಾಗಿ ಕಾಯಲಾರದು. ದಯವಿಟ್ಟು ಈಗಲೇ ಹತ್ತಿರದ ತುರ್ತು ಚಿಕಿತ್ಸಾ ಘಟಕಕ್ಕೆ ಹೋಗಿ. ನಾನು ಕ್ಲಿನಿಕ್‌ಗೆ ತಿಳಿಸುತ್ತಿದ್ದೇನೆ, ನಮ್ಮ ಆನ್-ಕಾಲ್ ವೈದ್ಯರು ಕೆಲವೇ ನಿಮಿಷಗಳಲ್ಲಿ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತಾರೆ.',
    'ml-IN':
      'ഞാൻ ഇവിടെ നിർത്തുകയാണ് — നിങ്ങൾ പറയുന്നതിന് ഉടനടി വൈദ്യസഹായം വേണം, അത് അപ്പോയിന്റ്മെന്റിനായി കാത്തിരിക്കാൻ കഴിയില്ല. ദയവായി ഉടനെ അടുത്തുള്ള എമർജൻസി വിഭാഗത്തിൽ പോകുക. ഞാൻ ക്ലിനിക്കിനെ അറിയിക്കുന്നു, ഞങ്ങളുടെ ഓൺ-കോൾ ഡോക്ടർ ഏതാനും മിനിറ്റിനുള്ളിൽ വിളിക്കും.',
    'pa-IN':
      'ਮੈਂ ਤੁਹਾਨੂੰ ਇੱਥੇ ਹੀ ਰੋਕਦੀ ਹਾਂ — ਜੋ ਤੁਸੀਂ ਦੱਸ ਰਹੇ ਹੋ ਉਸ ਲਈ ਤੁਰੰਤ ਡਾਕਟਰੀ ਮਦਦ ਚਾਹੀਦੀ ਹੈ, ਇਹ ਅਪਾਇੰਟਮੈਂਟ ਦੀ ਉਡੀਕ ਨਹੀਂ ਕਰ ਸਕਦਾ। ਕਿਰਪਾ ਕਰਕੇ ਹੁਣੇ ਨੇੜਲੇ ਐਮਰਜੈਂਸੀ ਰੂਮ ਜਾਓ। ਮੈਂ ਕਲੀਨਿਕ ਨੂੰ ਦੱਸ ਰਹੀ ਹਾਂ, ਸਾਡੇ ਆਨ-ਕਾਲ ਡਾਕਟਰ ਕੁਝ ਮਿੰਟਾਂ ਵਿੱਚ ਤੁਹਾਨੂੰ ਫੋਨ ਕਰਨਗੇ।',
  },
  amber: {
    'en-IN':
      'That sounds painful, and I do not want you waiting on it. Let me find you the earliest slot we have — I will also flag this for the doctor so they know before you arrive.',
    'hi-IN':
      'यह तकलीफ़देह लग रहा है, और मैं नहीं चाहती कि आप इंतज़ार करें। मैं आपके लिए सबसे जल्दी वाला स्लॉट देखती हूँ — और डॉक्टर को भी बता देती हूँ ताकि आपके आने से पहले उन्हें पता हो।',
    'hi-Latn-IN':
      'Yeh takleef-deh lag raha hai, aur main nahi chahti ki aap wait karein. Main aapke liye sabse jaldi wala slot dekhti hoon — aur doctor ko bhi bata deti hoon taaki aapke aane se pehle unhe pata ho.',
    'mr-IN':
      'हे त्रासदायक वाटतंय, आणि तुम्ही वाट पाहावी असं मला वाटत नाही. मी तुमच्यासाठी सर्वात लवकरची वेळ बघते — आणि डॉक्टरांनाही कळवते म्हणजे तुम्ही येण्याआधी त्यांना माहिती असेल.',
    'gu-IN':
      'આ તકલીફદાયક લાગે છે, અને હું નથી ઇચ્છતી કે તમે રાહ જુઓ. હું તમારા માટે સૌથી વહેલો સ્લોટ જોઉં છું — અને ડૉક્ટરને પણ જણાવી દઉં જેથી તમે આવો એ પહેલાં એમને ખબર હોય.',
    'bn-IN':
      'এটা কষ্টকর মনে হচ্ছে, আর আমি চাই না আপনি অপেক্ষা করুন। আমি আপনার জন্য সবচেয়ে তাড়াতাড়ি সময় দেখছি — ডাক্তারকেও জানিয়ে রাখছি যাতে আপনি আসার আগে তিনি জানেন।',
    'ta-IN':
      'இது வலியாக இருக்கும் போலிருக்கிறது, நீங்கள் காத்திருப்பதை நான் விரும்பவில்லை. உங்களுக்கு கிடைக்கக்கூடிய முதல் நேரத்தைப் பார்க்கிறேன் — மருத்துவரிடமும் தெரிவித்து வைக்கிறேன்.',
    'te-IN':
      'ఇది బాధగా ఉన్నట్టుంది, మీరు ఆగాలని నేను అనుకోవడం లేదు. మీకు దొరికే మొదటి సమయాన్ని చూస్తాను — డాక్టర్‌కి కూడా చెప్పి ఉంచుతాను.',
    'kn-IN':
      'ಇದು ನೋವಿನ ಸಂಗತಿ ಎನಿಸುತ್ತದೆ, ನೀವು ಕಾಯುವುದು ನನಗೆ ಬೇಡ. ನಿಮಗೆ ಸಿಗುವ ಅತಿ ಬೇಗದ ಸಮಯವನ್ನು ನೋಡುತ್ತೇನೆ — ವೈದ್ಯರಿಗೂ ತಿಳಿಸಿಡುತ್ತೇನೆ.',
    'ml-IN':
      'ഇത് വേദനാജനകമായി തോന്നുന്നു, നിങ്ങൾ കാത്തിരിക്കണമെന്ന് ഞാൻ ആഗ്രഹിക്കുന്നില്ല. ഏറ്റവും നേരത്തെയുള്ള സമയം നോക്കാം — ഡോക്ടറെയും അറിയിച്ചുവയ്ക്കാം.',
    'pa-IN':
      'ਇਹ ਤਕਲੀਫ਼ਦੇਹ ਲੱਗਦਾ ਹੈ, ਅਤੇ ਮੈਂ ਨਹੀਂ ਚਾਹੁੰਦੀ ਕਿ ਤੁਸੀਂ ਉਡੀਕ ਕਰੋ। ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਸਭ ਤੋਂ ਜਲਦੀ ਵਾਲਾ ਸਮਾਂ ਵੇਖਦੀ ਹਾਂ — ਡਾਕਟਰ ਨੂੰ ਵੀ ਦੱਸ ਦਿੰਦੀ ਹਾਂ।',
  },
  green: {
    'en-IN': 'Understood. Let me find a time that works for you.',
    'hi-IN': 'समझ गई। मैं आपके लिए सही समय देखती हूँ।',
    'hi-Latn-IN': 'Samajh gayi. Main aapke liye sahi time dekhti hoon.',
    'mr-IN': 'समजलं. मी तुमच्यासाठी योग्य वेळ बघते.',
    'gu-IN': 'સમજી ગઈ. હું તમારા માટે યોગ્ય સમય જોઉં છું.',
    'bn-IN': 'বুঝেছি। আমি আপনার জন্য উপযুক্ত সময় দেখছি।',
    'ta-IN': 'புரிந்தது. உங்களுக்கு ஏற்ற நேரத்தைப் பார்க்கிறேன்.',
    'te-IN': 'అర్థమైంది. మీకు సరిపోయే సమయం చూస్తాను.',
    'kn-IN': 'ಅರ್ಥವಾಯಿತು. ನಿಮಗೆ ಸೂಕ್ತವಾದ ಸಮಯ ನೋಡುತ್ತೇನೆ.',
    'ml-IN': 'മനസ്സിലായി. നിങ്ങൾക്ക് അനുയോജ്യമായ സമയം നോക്കാം.',
    'pa-IN': 'ਸਮਝ ਗਈ। ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਢੁਕਵਾਂ ਸਮਾਂ ਵੇਖਦੀ ਹਾਂ।',
  },
}

export function triage(symptoms: string): TriageResult {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(symptoms))) {
      return {
        band: rule.band,
        reason: rule.reason,
        script: SCRIPTS[rule.band],
        alertPractice: rule.alertPractice,
        bookWithinDays: rule.bookWithinDays,
      }
    }
  }
  return {
    band: 'green',
    reason: 'Routine',
    script: SCRIPTS.green,
    alertPractice: false,
    bookWithinDays: 14,
  }
}
