import { describe, it, expect } from 'vitest'
import { searchKnowledge } from './knowledge'
import { BRANCHES, DOCTORS, TREATMENTS } from './clinic-data'

describe('clinic data depth', () => {
  it('has multiple branches', () => expect(BRANCHES.length).toBeGreaterThanOrEqual(3))
  it('has a full clinical team', () => expect(DOCTORS.length).toBeGreaterThanOrEqual(6))
  it('gives every doctor real qualifications and a registration number', () => {
    for (const d of DOCTORS) {
      expect(d.qualifications, d.name).toMatch(/BDS/)
      expect(d.registration, d.name).toMatch(/Dental Council/)
      expect(d.experienceYears).toBeGreaterThan(0)
      expect(d.languages.length).toBeGreaterThan(1)
    }
  })
  it('describes every treatment in enough depth to answer a caller', () => {
    for (const t of TREATMENTS) {
      expect(t.whatItIs.length, t.name).toBeGreaterThan(40)
      expect(t.anaesthesia, t.name).toBeTruthy()
      expect(t.priceMax).toBeGreaterThan(t.priceMin)
    }
  })
})

describe('knowledge answers real caller questions', () => {
  const cases: [string, RegExp][] = [
    ["what are Dr Mehta's qualifications", /MDS in Orthodontics/],
    ['which doctor does braces', /Mehta|Orthodont/],
    ['do you have a branch in Powai', /Powai|Galleria/],
    ['how many branches do you have', /three branches|Bandra|Andheri/],
    ['who sees children', /Qureshi|Paediatric|children/],
    ['does Dr Iyer speak Tamil', /Tamil/],
    ['how long does a root canal take', /90 minutes|root canal/i],
    ['is a root canal painful', /anaesthe/i],
    ['how much is teeth whitening', /8000|whiten/i],
    ['do you take Niva Bupa', /Niva Bupa/],
    ['do you do EMI', /EMI/],
    ['what is your cancellation policy', /twenty four hours/],
    ['what should I bring for my first visit', /X-ray|insurance card/i],
    ['do you have parking in Andheri', /parking|street/i],
    ['who does wisdom tooth surgery', /Iyer|Deshpande|wisdom/i],
    ['can I get a second opinion', /second opinion/i],
    ['how do you sterilise instruments', /autoclave/i],
    ['what is the recovery after wisdom tooth removal', /swelling|three to five days/i],
  ]

  it.each(cases)('answers "%s"', (q, expected) => {
    const hit = searchKnowledge(q, 'en-IN')
    expect(hit, `no answer for "${q}"`).not.toBeNull()
    expect(hit!.text).toMatch(expected)
  })

  it('still refuses to answer what it does not know', () => {
    expect(searchKnowledge('do you sell electric toothbrushes', 'en-IN')).toBeNull()
    expect(searchKnowledge('what is the capital of France', 'en-IN')).toBeNull()
  })
})
