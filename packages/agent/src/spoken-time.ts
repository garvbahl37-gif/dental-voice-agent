import type { Lang } from '@vaani/shared'

/**
 * A time, written the way it is said.
 *
 * The old version localised the weekday and left the rest in English, so the
 * model was handed "सोमवार at 12 thirty in the afternoon" and read it out as
 * exactly that hybrid — "twelve बारह thirty". Half a sentence in each language
 * is worse than either.
 *
 * Hindi and Marathi do not say "twelve thirty" at all. They say "half past
 * eleven-and-a-bit" by way of a dedicated word: साढ़े बारह is 12:30, and one and
 * two o'clock have their own words entirely (डेढ़, ढाई). Getting this wrong is
 * the difference between a receptionist and a translation.
 *
 * For the languages whose idiom is not written out here, the phrase is left in
 * plain digits and the model is told to say it natively — a model rendering
 * "12:30" into Tamil is on far safer ground than this file guessing at Tamil
 * grammar and being confidently wrong.
 */

const HI_NUM = [
  '',
  'एक',
  'दो',
  'तीन',
  'चार',
  'पाँच',
  'छह',
  'सात',
  'आठ',
  'नौ',
  'दस',
  'ग्यारह',
  'बारह',
]

const MR_NUM = [
  '',
  'एक',
  'दोन',
  'तीन',
  'चार',
  'पाच',
  'सहा',
  'सात',
  'आठ',
  'नऊ',
  'दहा',
  'अकरा',
  'बारा',
]

/** Which part of the day, in the caller's own words. */
function period(h: number, lang: Lang): string {
  const morning = h < 12
  const afternoon = h >= 12 && h < 17
  if (lang === 'hi-IN') return morning ? 'सुबह' : afternoon ? 'दोपहर' : 'शाम'
  if (lang === 'mr-IN') return morning ? 'सकाळी' : afternoon ? 'दुपारी' : 'संध्याकाळी'
  if (lang === 'hi-Latn-IN') return morning ? 'subah' : afternoon ? 'dopahar' : 'shaam'
  return morning ? 'in the morning' : afternoon ? 'in the afternoon' : 'in the evening'
}

/**
 * The clock itself.
 *
 * Devanagari counts the quarters with words rather than numbers: सवा for the
 * quarter past, साढ़े for the half, पौने for the quarter to — and the half past
 * one and two are irregular, which is exactly the sort of thing that makes an
 * agent sound foreign when it gets it wrong.
 */
function clock(h12: number, m: number, lang: Lang): string {
  const num = lang === 'mr-IN' ? MR_NUM : HI_NUM
  const next = h12 === 12 ? 1 : h12 + 1

  if (lang === 'hi-IN') {
    if (m === 0) return `${num[h12]} बजे`
    if (m === 15) return `सवा ${num[h12]}`
    if (m === 30) return h12 === 1 ? 'डेढ़' : h12 === 2 ? 'ढाई' : `साढ़े ${num[h12]}`
    if (m === 45) return `पौने ${num[next]}`
    return `${num[h12]} बजकर ${m} मिनट`
  }

  if (lang === 'mr-IN') {
    if (m === 0) return `${num[h12]} वाजता`
    if (m === 15) return `सव्वा ${num[h12]}`
    if (m === 30) return h12 === 1 ? 'दीड' : h12 === 2 ? 'अडीच' : `साडे ${num[h12]}`
    if (m === 45) return `पावणे ${num[next]}`
    return `${num[h12]} वाजून ${m} मिनिटे`
  }

  if (lang === 'hi-Latn-IN') {
    if (m === 0) return `${h12} baje`
    if (m === 30) return h12 === 1 ? 'derh' : h12 === 2 ? 'dhai' : `saadhe ${h12}`
    if (m === 15) return `sawa ${h12}`
    if (m === 45) return `paune ${next}`
    return `${h12}:${String(m).padStart(2, '0')}`
  }

  // English, and every language whose idiom is not written out above.
  if (m === 0) return `${h12}`
  if (m === 30) return `${h12} thirty`
  return `${h12} ${String(m).padStart(2, '0')}`
}

/** The BCP-47 tag to ask the platform for a weekday in. */
function dateLocale(lang: Lang): string {
  return lang === 'hi-Latn-IN' ? 'en-IN' : lang
}

export interface SpokenTime {
  /** The whole thing, ready to be said aloud. */
  phrase: string
  /** True when the phrase is already idiomatic and must not be reworded. */
  native: boolean
}

export function spokenTime(iso: string, lang: Lang): SpokenTime {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12

  let day: string
  try {
    day = d.toLocaleDateString(dateLocale(lang), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  } catch {
    // An unsupported locale must not take the call down.
    day = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  }

  const written = clock(h12, m, lang)
  const when = period(h, lang)

  if (lang === 'hi-IN' || lang === 'mr-IN' || lang === 'hi-Latn-IN') {
    // Period first, as it is said: "सोमवार, दोपहर साढ़े बारह".
    return { phrase: `${day}, ${when} ${written}`, native: true }
  }

  const phrase = `${day} at ${written} ${when}`
  return { phrase, native: lang === 'en-IN' }
}
