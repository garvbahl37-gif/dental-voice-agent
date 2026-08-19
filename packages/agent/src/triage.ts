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

const SCRIPTS: Record<TriageBand, Record<Lang, string>> = {
  red: {
    'en-IN':
      'I need to stop you there — what you are describing needs urgent medical attention, and it should not wait for a dental appointment. Please go to your nearest emergency room right away. I am alerting the clinic now, and our on-call dentist will call you within a few minutes.',
    'hi-IN':
      'मैं आपको यहीं रोकूँगी — जो आप बता रहे हैं उसमें तुरंत मेडिकल ध्यान चाहिए, यह अपॉइंटमेंट का इंतज़ार नहीं कर सकता। कृपया अभी अपने नज़दीकी इमरजेंसी रूम जाइए। मैं क्लिनिक को सूचित कर रही हूँ, हमारे ऑन-कॉल डॉक्टर कुछ ही मिनट में आपको कॉल करेंगे।',
    'hi-Latn-IN':
      'Main aapko yahin rokungi — jo aap bata rahe hain usme turant medical attention chahiye, yeh appointment ka wait nahi kar sakta. Please abhi nazdeeki emergency room jaiye. Main clinic ko alert kar rahi hoon, hamare on-call doctor kuch hi minute mein aapko call karenge.',
  },
  amber: {
    'en-IN':
      'That sounds painful, and I do not want you waiting on it. Let me find you the earliest slot we have — I will also flag this for the doctor so they know before you arrive.',
    'hi-IN':
      'यह तकलीफ़देह लग रहा है, और मैं नहीं चाहती कि आप इंतज़ार करें। मैं आपके लिए सबसे जल्दी वाला स्लॉट देखती हूँ — और डॉक्टर को भी बता देती हूँ ताकि आपके आने से पहले उन्हें पता हो।',
    'hi-Latn-IN':
      'Yeh takleef-deh lag raha hai, aur main nahi chahti ki aap wait karein. Main aapke liye sabse jaldi wala slot dekhti hoon — aur doctor ko bhi bata deti hoon taaki aapke aane se pehle unhe pata ho.',
  },
  green: {
    'en-IN': 'Understood. Let me find a time that works for you.',
    'hi-IN': 'समझ गई। मैं आपके लिए सही समय देखती हूँ।',
    'hi-Latn-IN': 'Samajh gayi. Main aapke liye sahi time dekhti hoon.',
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
