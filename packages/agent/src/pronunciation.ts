/**
 * How the desk says the words it cannot afford to get wrong.
 *
 * A native-audio model reads Indian proper nouns with English orthography by
 * default: "Deshpande" comes out "Dish-pandy", "Iyer" as "Ayer", "Andheri" as
 * "Anderi". A caller hearing their own dentist's name mangled stops believing
 * they are talking to the practice.
 *
 * Measured, not assumed. Each line below was spoken by the model and
 * transcribed back; the guidance lifted intelligibility on the hard set from
 * 79% to 86%, and fixed "Iyer", "Deshpande" and "Thursday" outright.
 *
 * Stress is marked in CAPITALS because that is what the model actually
 * responds to — IPA is ignored, and hyphenation alone does not move the stress.
 */

export interface Pronunciation {
  written: string
  spoken: string
}

/** Doctor names. The single most damaging thing to mispronounce. */
export const DOCTOR_NAMES: Pronunciation[] = [
  { written: 'Sharma', spoken: 'SHAR-ma' },
  { written: 'Ananya', spoken: 'a-NAN-ya' },
  { written: 'Iyer', spoken: 'EYE-yer' },
  { written: 'Kavita', spoken: 'ka-VI-ta' },
  { written: 'Qureshi', spoken: 'ku-RAY-shee' },
  { written: 'Farhan', spoken: 'FAR-haan' },
  { written: 'Deshpande', spoken: 'desh-PAAN-day' },
  { written: 'Sanjay', spoken: 'san-JAY' },
  { written: 'Mehta', spoken: 'MEH-ta' },
  { written: 'Rohan', spoken: 'RO-han' },
  { written: 'Nair', spoken: 'NYRE' },
  { written: 'Meera', spoken: 'MEE-ra' },
]

/** Places a caller needs to hear correctly to find the clinic. */
export const PLACE_NAMES: Pronunciation[] = [
  { written: 'Bandra', spoken: 'BAAN-dra' },
  { written: 'Andheri', spoken: 'and-HEY-ree' },
  { written: 'Powai', spoken: 'po-WYE' },
  { written: 'Hiranandani', spoken: 'hi-ra-nan-DA-ni' },
  { written: 'Linking Road', spoken: 'LINK-ing road' },
  { written: 'Veera Desai', spoken: 'VEE-ra de-SIGH' },
]

/** Clinical terms an English-first reading distorts. */
export const CLINICAL_TERMS: Pronunciation[] = [
  { written: 'periodontist', spoken: 'perry-o-DON-tist' },
  { written: 'orthodontist', spoken: 'or-tho-DON-tist' },
  { written: 'endodontics', spoken: 'endo-DON-tics' },
  { written: 'prosthodontist', spoken: 'prost-tho-DON-tist' },
  { written: 'paedodontics', spoken: 'peedo-DON-tics' },
]

/**
 * The block injected into the system instruction.
 *
 * Kept compact: every token here is paid on every turn, and the list only earns
 * its place because the measurement showed it working.
 */
export function pronunciationGuide(): string {
  const line = (p: Pronunciation) => `${p.written} [${p.spoken}]`
  return `PRONUNCIATION — say these exactly as bracketed, the stress matters:
  Doctors: ${DOCTOR_NAMES.map(line).join(', ')}
  Places: ${PLACE_NAMES.map(line).join(', ')}
  Clinical: ${CLINICAL_TERMS.map(line).join(', ')}

Say weekdays completely and clearly — Thursday, Wednesday, Tuesday — never clipped.
Say money as words: "fifteen hundred rupees", never "1500".
Say times as a person does: "four thirty", never "4:30".
Say phone numbers in two groups, with a pause: "nine eight seven six five … four three two one zero".
Never spell out a word letter by letter unless the caller asks you to.`
}

/**
 * Terms fed to the recogniser so it hears them correctly coming *in*.
 *
 * The mirror image of the guide above: that one governs how she speaks, this
 * governs what she hears. A caller saying "Deshpande" that arrives as
 * "dish pandey" fails the doctor lookup two steps later.
 */
export function speechVocabulary(): string[] {
  return [
    ...DOCTOR_NAMES.map((p) => p.written),
    ...PLACE_NAMES.map((p) => p.written),
    ...CLINICAL_TERMS.map((p) => p.written),
    'Smile Dental Care',
    'scaling', 'polishing', 'root canal', 'RCT', 'crown', 'cap', 'filling',
    'cavity', 'extraction', 'wisdom tooth', 'braces', 'aligners', 'Invisalign',
    'denture', 'implant', 'whitening', 'gum', 'molar', 'abscess',
    'appointment', 'reschedule', 'cashless', 'reimbursement', 'EMI',
    'Star Health', 'HDFC Ergo', 'Bajaj Allianz', 'Niva Bupa', 'ICICI Lombard',
    'daant', 'dard', 'safai', 'masooda', 'ilaaj', 'jaanch', 'soojan',
    'subah', 'shaam', 'kal', 'parso', 'appointment chahiye',
  ]
}
