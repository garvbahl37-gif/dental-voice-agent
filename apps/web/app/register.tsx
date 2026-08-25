'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The day's register.
 *
 * Every clinic in India keeps one: a ruled book at the front desk where the
 * receptionist writes down who rang, what they wanted, and what was done about
 * it. This product replaces the person holding the pen, so the register is the
 * artifact it should be judged against — and a page of it says more about
 * eleven languages than any list of language names can, because the scripts are
 * simply *there*, in the entries, the way they are in a real Mumbai register.
 *
 * It replaced a marquee of language names. That strip showed the same eleven
 * facts and demonstrated none of them: a scrolling list of the word "Tamil" is
 * decoration, a Tamil sentence in the 09:04 row is evidence.
 *
 * The rows fill in as it comes into view, one after another, because that is
 * how a register fills — over a morning, an entry at a time.
 */

interface Entry {
  at: string
  who: string
  said: string
  lang?: string
  tongue: string
  wanted: string
  outcome: string
  /** Outcomes that are not a booking are the interesting ones. */
  kind?: 'booked' | 'escalated' | 'declined'
}

const DAY: Entry[] = [
  {
    at: '09:04',
    who: 'Meera Iyer',
    said: 'வணக்கம், cleaning-க்கு appointment வேணும்',
    lang: 'ta',
    tongue: 'Tamil',
    wanted: 'Scaling & polishing',
    outcome: 'Thu 11:30 · Andheri',
    kind: 'booked',
  },
  {
    at: '09:31',
    who: 'Rajesh Kulkarni',
    said: 'मला उद्या डॉक्टरांची अपॉइंटमेंट हवी',
    lang: 'mr',
    tongue: 'Marathi',
    wanted: 'Consultation',
    outcome: 'Wed 18:00 · Bandra',
    kind: 'booked',
  },
  {
    at: '10:12',
    who: 'Unknown',
    said: 'Koi painkiller bata do na, bahut dard hai',
    lang: 'hi-Latn',
    tongue: 'Hinglish',
    wanted: 'Medicine advice',
    outcome: 'Refused · offered same-day slot',
    kind: 'declined',
  },
  {
    at: '10:48',
    who: 'Farida Sheikh',
    said: 'دانت میں بہت درد ہے — sujan bhi hai',
    tongue: 'Urdu · Hinglish',
    wanted: 'Swelling with pain',
    outcome: 'Escalated · emergency line given',
    kind: 'escalated',
  },
  {
    at: '11:20',
    who: 'Anitha Nair',
    said: 'എനിക്ക് ശനിയാഴ്ച ഒരു slot കിട്ടുമോ?',
    lang: 'ml',
    tongue: 'Malayalam',
    wanted: 'Filling',
    outcome: 'Sat 09:15 · Powai',
    kind: 'booked',
  },
  {
    at: '12:02',
    who: 'Harpreet Singh',
    said: 'ਮੈਨੂੰ ਦੰਦ ਦੀ ਸਫ਼ਾਈ ਕਰਵਾਉਣੀ ਹੈ',
    lang: 'pa',
    tongue: 'Punjabi',
    wanted: 'Scaling & polishing',
    outcome: 'Fri 16:45 · Bandra',
    kind: 'booked',
  },
  {
    at: '12:39',
    who: 'Sourav Das',
    said: 'রুট ক্যানেলের খরচ কত পড়বে?',
    lang: 'bn',
    tongue: 'Bengali',
    wanted: 'Root canal — price',
    outcome: 'Not on fee list · callback logged',
    kind: 'declined',
  },
  {
    at: '13:15',
    who: 'Dhruv Patel',
    said: 'મારે આજે જ દેખાડવું છે, બહુ દુખે છે',
    lang: 'gu',
    tongue: 'Gujarati',
    wanted: 'Same-day pain',
    outcome: 'Today 17:30 · Andheri',
    kind: 'booked',
  },
]

export function Register() {
  const [shown, setShown] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(DAY.length)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return
        io.disconnect()
        // An entry at a time, the way a morning fills one.
        DAY.forEach((_, i) => setTimeout(() => setShown(i + 1), 90 + i * 190))
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div className="rg" ref={root}>
      <div className="rg-head">
        <span className="rg-title">The register, this morning</span>
        <span className="rg-note">
          Bandra · Andheri · Powai — nobody at the desk, every line answered
        </span>
      </div>

      <div className="rg-cols" aria-hidden>
        <span>Time</span>
        <span>Caller</span>
        <span>What they said</span>
        <span>Outcome</span>
      </div>

      <ol className="rg-rows">
        {DAY.map((e, i) => (
          <li key={e.at} className={`rg-row${i < shown ? ' is-in' : ''}`}>
            <span className="rg-at mono">{e.at}</span>

            <span className="rg-who">
              {e.who}
              <span className="rg-tongue">{e.tongue}</span>
            </span>

            <span className="rg-said" lang={e.lang}>
              {e.said}
              <span className="rg-wanted">{e.wanted}</span>
            </span>

            <span className={`rg-out rg-${e.kind ?? 'booked'}`}>{e.outcome}</span>
          </li>
        ))}
      </ol>

      <p className="rg-foot">
        Eight of the morning&rsquo;s calls. Two were not bookings — one asked for medicine and
        one for a price that is not on the list, and both are written down as what they were.
      </p>
    </div>
  )
}
