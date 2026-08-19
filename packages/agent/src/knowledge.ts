import type { Lang } from '@vaani/shared'
import { BRANCHES, DOCTORS, INSURERS_CASHLESS, PAYMENT, POLICIES, TREATMENTS } from './clinic-data'

/**
 * Practice knowledge base with grounded retrieval.
 *
 * Scoring is BM25-flavoured keyword matching over a small, curated corpus.
 * Embeddings would be over-engineering here: the corpus is a few dozen
 * documents about one clinic, and the failure mode that actually costs money
 * is not "missed a semantically similar phrasing" — it is the model
 * confidently inventing a price or an insurance policy.
 *
 * So the important part is not the ranking. It is the **threshold**: below it,
 * the tool returns nothing and the agent is instructed to say it does not know
 * and offer a callback. Refusing to answer is the correct behaviour.
 */

export interface KbDoc {
  id: string
  title: string
  keywords: string[]
  text: Record<Lang, string>
}

const CURATED: KbDoc[] = [
  {
    id: 'hours',
    title: 'Opening hours',
    keywords: ['hours', 'open', 'close', 'closing', 'closes', 'opens', 'timing', 'timings',
      'time', 'shut', 'sunday', 'saturday', 'weekend', 'khula', 'band', 'samay', 'kab'],
    text: {
      'en-IN': 'Bandra is open Monday to Saturday, nine to seven. Andheri is ten to eight, and open Sunday morning for emergencies. Powai is ten to seven, closed Sunday.',
      'hi-IN': 'बांद्रा सोमवार से शनिवार, नौ से सात। अंधेरी दस से आठ, और रविवार सुबह इमरजेंसी के लिए खुला। पवई दस से सात, रविवार बंद।',
      'hi-Latn-IN': 'Bandra Monday se Saturday, nau se saat. Andheri das se aath, aur Sunday subah emergency ke liye khula. Powai das se saat, Sunday band.',
    },
  },
  {
    id: 'sterilisation',
    title: 'Hygiene and sterilisation',
    keywords: ['hygiene', 'sterile', 'sterilisation', 'sterilise', 'sterilised', 'instruments',
      'autoclave', 'safai', 'disposable', 'gloves'],
    text: {
      'en-IN': 'Every instrument goes through autoclave sterilisation with cycle records kept, we use single-use disposables wherever possible, and the chairs are wiped down between every patient.',
      'hi-IN': 'हर उपकरण ऑटोक्लेव स्टरलाइज़ेशन से गुज़रता है और रिकॉर्ड रखा जाता है। जहाँ संभव हो सिंगल-यूज़ डिस्पोज़ेबल इस्तेमाल करते हैं, और हर मरीज़ के बाद चेयर साफ़ की जाती है।',
      'hi-Latn-IN': 'Har instrument autoclave sterilisation se guzarta hai aur record rakha jaata hai. Jahan possible ho single-use disposable use karte hain, aur har patient ke baad chair saaf ki jaati hai.',
    },
  },
  {
    id: 'aftercare-extraction',
    title: 'Aftercare following an extraction',
    keywords: ['aftercare', 'after', 'extraction', 'removed', 'nikala', 'baad', 'care', 'bleeding', 'rinse', 'eat'],
    text: {
      'en-IN': 'After an extraction, bite on the gauze for about half an hour, keep to cool soft food for the day, and avoid rinsing hard or using a straw for twenty four hours. If bleeding does not settle, call us.',
      'hi-IN': 'दांत निकलवाने के बाद आधे घंटे तक गॉज़ दबाकर रखिए, दिन भर ठंडा और नरम खाना खाइए, और चौबीस घंटे तक ज़ोर से कुल्ला या स्ट्रॉ इस्तेमाल न करें। खून न रुके तो हमें कॉल कीजिए।',
      'hi-Latn-IN': 'Daant nikalwane ke baad aadhe ghante tak gauze dabakar rakhiye, din bhar thanda aur naram khana khaiye, aur chaubees ghante tak zor se kulla ya straw use na karein. Khoon na ruke toh humein call kijiye.',
    },
  },
  {
    id: 'emergency-policy',
    title: 'Emergency and after-hours',
    keywords: ['emergency', 'urgent', 'night', 'after hours', 'weekend', 'sunday', 'oncall', 'turant', 'raat'],
    text: {
      'en-IN': 'For genuine emergencies we keep slots free every morning, and there is an on-call dentist outside working hours. If it is serious — heavy bleeding, swelling near the eye or throat, trouble breathing — please go straight to a hospital emergency room.',
      'hi-IN': 'सच्ची इमरजेंसी के लिए हम हर सुबह स्लॉट खाली रखते हैं, और काम के घंटों के बाहर ऑन-कॉल डॉक्टर उपलब्ध रहते हैं। अगर गंभीर है — ज़्यादा खून, आँख या गले के पास सूजन, साँस की दिक्कत — तो सीधे अस्पताल की इमरजेंसी जाइए।',
      'hi-Latn-IN': 'Sacchi emergency ke liye hum har subah slot khaali rakhte hain, aur kaam ke ghanton ke bahar on-call doctor available rehte hain. Agar serious hai — zyada khoon, aankh ya gale ke paas soojan, saans ki dikkat — toh seedhe hospital ki emergency jaiye.',
    },
  },
]

/**
 * Retrieval threshold.
 *
 * Deliberately conservative. Answering "I don't know, let me have someone call
 * you" is a perfectly good front-desk answer. Inventing an insurance policy is
 * not, and it is the kind of error a practice discovers only when a patient
 * arrives expecting cashless treatment.
 */
/**
 * Documents generated from the structured clinic data.
 *
 * Written rather than hand-curated so the knowledge base cannot drift from the
 * scheduling data: one doctor, one source. Each doctor and each treatment gets
 * its own document, which is what lets "what are Dr. Mehta's qualifications?"
 * and "how long does a root canal take?" both find a precise answer instead of
 * a generic page about the practice.
 */
function generated(): KbDoc[] {
  const docs: KbDoc[] = []

  for (const d of DOCTORS) {
    const where = d.branches.map((b) => BRANCHES.find((x) => x.id === b)?.area).filter(Boolean)
    const days = d.days
      .map((n) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n])
      .join(', ')
    const text =
      `${d.name} is our ${d.title}. ${d.qualifications}. ` +
      `${d.experienceYears} years of experience. Handles ${d.specialties.join(', ')}. ` +
      `Speaks ${d.languages.join(', ')}. Sees patients at ${where.join(' and ')} on ${days}. ` +
      `Consultation is ${d.consultFee} rupees. ${d.note}`
    const surname = d.name.replace('Dr. ', '').split(' ')
    docs.push({
      id: `doctor-${d.id}`,
      title: d.name,
      keywords: [
        ...surname.map((w) => w.toLowerCase()),
        'doctor', 'dentist', 'qualification', 'qualifications', 'degree', 'experience',
        'specialist', 'who', 'daaktar',
        ...d.specialties.flatMap((x) => x.split(' ')),
        ...d.languages.map((l) => l.toLowerCase()),
        ...where.filter((w): w is string => Boolean(w)).map((w) => w.toLowerCase()),
      ],
      text: { 'en-IN': text, 'hi-IN': text, 'hi-Latn-IN': text },
    })
  }

  for (const t of TREATMENTS) {
    const text =
      `${t.name}. ${t.whatItIs} Usually ${t.sittings}, about ${t.durationMin} minutes a visit. ` +
      `Cost is between ${t.priceMin} and ${t.priceMax} rupees. Anaesthesia: ${t.anaesthesia}. ` +
      (t.aftercare !== 'none' ? `Afterwards: ${t.aftercare}. ` : '') +
      (t.recovery !== 'none' ? `Recovery: ${t.recovery}. ` : '') +
      (t.cashless ? 'Cashless insurance applies to this treatment.' : '')
    docs.push({
      id: `treatment-${t.serviceId}`,
      title: t.name,
      keywords: [
        ...t.name.toLowerCase().split(/[^a-z]+/).filter(Boolean),
        ...t.alsoCalled.flatMap((x) => x.toLowerCase().split(/\s+/)),
        'cost', 'price', 'kitna', 'charge', 'fees', 'time', 'long', 'sittings',
        'painful', 'pain', 'recovery', 'aftercare',
      ],
      text: { 'en-IN': text, 'hi-IN': text, 'hi-Latn-IN': text },
    })
  }

  for (const b of BRANCHES) {
    const text =
      `${b.name}. ${b.address}, ${b.landmark}. Open ${b.hours}; Sunday ${b.sunday}. ` +
      `${b.transport}. Parking: ${b.parking}. ${b.chairs} chairs. ` +
      `Facilities: ${b.facilities.join(', ')}. Phone ${b.phone}.`
    docs.push({
      id: `branch-${b.id}`,
      title: b.name,
      keywords: [
        ...b.area.toLowerCase().split(/\s+/),
        'branch', 'branches', 'location', 'locations', 'address', 'where', 'clinic',
        'parking', 'reach', 'directions', 'hours', 'open', 'timing', 'kahan', 'pata',
      ],
      text: { 'en-IN': text, 'hi-IN': text, 'hi-Latn-IN': text },
    })
  }

  const branchList = BRANCHES.map((b) => `${b.area} (${b.hours})`).join('; ')
  docs.push({
    id: 'branches-all',
    title: 'All branches',
    keywords: ['branch', 'branches', 'many', 'nearest', 'closest', 'all'],
    text: {
      'en-IN': `We have three branches: ${branchList}. Bandra is the main one with the in-house lab.`,
      'hi-IN': `हमारी तीन ब्रांच हैं: ${branchList}.`,
      'hi-Latn-IN': `Hamari teen branch hain: ${branchList}.`,
    },
  })

  const payment =
    `We do cashless with ${INSURERS_CASHLESS.join(', ')}. For other insurers we give a receipt for ` +
    `reimbursement. We take ${PAYMENT.methods}. ${PAYMENT.emi}. ${PAYMENT.deposit}. ${PAYMENT.gst}`
  docs.push({
    id: 'payment',
    title: 'Payment, insurance and EMI',
    keywords: ['insurance', 'cashless', 'claim', 'policy', 'star', 'hdfc', 'ergo', 'bajaj', 'niva',
      'bupa', 'icici', 'payment', 'card', 'upi', 'emi', 'installment', 'gst', 'bima', 'paisa', 'advance'],
    text: { 'en-IN': payment, 'hi-IN': payment, 'hi-Latn-IN': payment },
  })

  for (const [key, value] of Object.entries(POLICIES)) {
    docs.push({
      id: `policy-${key}`,
      title: key,
      keywords: [
        ...key.replace(/([A-Z])/g, ' $1').toLowerCase().split(/\s+/),
        'policy', 'rule', 'charge', 'bring', 'expect',
      ],
      text: { 'en-IN': value, 'hi-IN': value, 'hi-Latn-IN': value },
    })
  }

  return docs
}

const MIN_SCORE = 2

/**
 * A multi-word question must match on at least two distinct keywords.
 *
 * One shared word is not evidence of relevance, and the failure it causes is
 * not a harmless miss. "Will my tooth need to be removed?" shares exactly one
 * word with the post-extraction aftercare document — answering it with
 * aftercare instructions would be both wrong and clinically inappropriate.
 *
 * Requiring corroboration is what turns a keyword search into grounded
 * retrieval.
 */
const MIN_DISTINCT_TERMS = 2

/**
 * A term appearing in at most this many documents is distinctive enough to
 * stand alone.
 *
 * "EMI", "Tamil" and "autoclave" each name exactly one page — demanding a
 * second matching word there just refuses answerable questions. "Removed"
 * appears on two pages, and "will my tooth need to be removed" is exactly the
 * clinical question the corroboration rule exists to refuse.
 */
const DISTINCTIVE_MAX_DF = 1

/** How many documents contain each keyword. Computed once. */
let _df: Map<string, number> | null = null
function documentFrequency(): Map<string, number> {
  if (_df) return _df
  const df = new Map<string, number>()
  for (const doc of ALL_DOCS) {
    for (const k of new Set(doc.keywords)) df.set(k, (df.get(k) ?? 0) + 1)
  }
  _df = df
  return df
}

/** Shortest prefix two words must share to count as the same stem. */
const STEM_LEN = 4

let _all: KbDoc[] | null = null
const ALL_DOCS: KbDoc[] = new Proxy([] as KbDoc[], {
  get(_t, prop) {
    _all ??= [...CURATED, ...generated()]
    return Reflect.get(_all, prop)
  },
})

/** Hand-written pages first, then everything derived from the clinic data. */
export const KNOWLEDGE: KbDoc[] = CURATED

export interface KbHit {
  id: string
  title: string
  text: string
  score: number
  /**
   * True when the text is source-language facts rather than a phrase written
   * in the caller's language. The agent renders these in-language rather than
   * reading them out verbatim.
   */
  needsRendering?: boolean
}

function sameStem(a: string, b: string): boolean {
  const n = Math.min(STEM_LEN, a.length, b.length)
  return n >= STEM_LEN && a.slice(0, n) === b.slice(0, n)
}

export function searchKnowledge(query: string, lang: Lang): KbHit | null {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2)

  if (terms.length === 0) return null

  let best: (KbHit & { matched: number; exact: number; distinctive: number }) | null = null

  for (const doc of ALL_DOCS) {
    let score = 0
    let matched = 0
    let exact = 0
    let distinctive = 0
    const df = documentFrequency()

    for (const term of terms) {
      if (doc.keywords.includes(term)) {
        score += 2
        matched++
        exact++
        if ((df.get(term) ?? 99) <= DISTINCTIVE_MAX_DF) distinctive++
      } else if (doc.keywords.some((k) => sameStem(k, term))) {
        // Morphology: "timings" vs "timing", "located" vs "location".
        score += 1
        matched++
      } else if (doc.text['en-IN'].toLowerCase().includes(term)) {
        // Body mentions add weight but never corroborate on their own — that
        // is the loophole the distinct-term rule exists to close.
        score += 0.5
      }
    }

    if (score > (best?.score ?? 0)) {
      best = { id: doc.id, title: doc.title, text: doc.text[lang], score, matched, exact, distinctive }
    }
  }

  if (!best || best.score < MIN_SCORE) return null

  const rendered = best.id.startsWith('doctor-') || best.id.startsWith('treatment-') ||
    best.id.startsWith('branch-') || best.id.startsWith('policy-') ||
    best.id === 'payment' || best.id === 'branches-all'

  // One distinctive term is evidence enough — it names a single page.
  if (best.distinctive > 0) {
    return { id: best.id, title: best.title, text: best.text, score: best.score, needsRendering: rendered }
  }

  // Otherwise a multi-word query must corroborate across two generic terms.
  const required = terms.length === 1 ? 1 : MIN_DISTINCT_TERMS
  if (best.matched < required) return null
  if (terms.length === 1 && best.exact < 1) return null

  return { id: best.id, title: best.title, text: best.text, score: best.score, needsRendering: rendered }
}
