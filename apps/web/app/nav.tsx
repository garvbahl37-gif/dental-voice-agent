'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The top bar.
 *
 * Three columns, not a flex row with space-between: the mark holds the left,
 * the links sit dead centre whatever their combined width, and the action holds
 * the right. Centring links inside a two-item flex row is not possible without
 * the columns, which is why they used to drift toward the action.
 *
 * It detaches on scroll. Flush against the top it is a bar; a few pixels down
 * it lifts into a floating pill with real glass behind it. The change is the
 * only thing telling a reader they have left the top of the page, and it costs
 * one class.
 */

const LINKS = [
  { href: '#does', id: 'does', label: 'What it does' },
  { href: '#limits', id: 'limits', label: 'What it won’t do' },
  { href: '#channels', id: 'channels', label: 'Where it answers' },
] as const

export function Nav() {
  const [lifted, setLifted] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const rail = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /**
   * Which section is being read.
   *
   * The band nearest the top of the viewport wins, rather than the first one
   * intersecting — with tall sections the first-intersecting rule leaves the
   * previous section marked active long after it has scrolled away.
   */
  useEffect(() => {
    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(
      (n): n is HTMLElement => Boolean(n),
    )
    if (!sections.length) return

    let frame = 0
    const pick = () => {
      frame = 0
      let best: { id: string; d: number } | null = null
      for (const s of sections) {
        const top = s.getBoundingClientRect().top
        // A section counts as current once its top passes a third of the way
        // down the viewport, so the mark changes as it is reached, not as it
        // is left.
        const d = Math.abs(top - window.innerHeight * 0.33)
        if (top < window.innerHeight * 0.66 && (!best || d < best.d)) best = { id: s.id, d }
      }
      setActive(best?.id ?? null)
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(pick)
    }
    pick()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  /**
   * The indicator slides between links rather than appearing under each.
   *
   * Measured from the live element, because the labels are different widths in
   * every language the page might be translated into and hard-coded offsets
   * would be wrong the moment one changed.
   */
  useEffect(() => {
    const bar = pill.current
    const box = rail.current
    if (!bar || !box) return
    if (!active) {
      bar.style.opacity = '0'
      return
    }
    const link = box.querySelector<HTMLElement>(`[data-nav="${active}"]`)
    if (!link) return
    bar.style.opacity = '1'
    bar.style.width = `${link.offsetWidth}px`
    bar.style.transform = `translateX(${link.offsetLeft}px)`
  }, [active])

  return (
    <nav className={`lp-nav${lifted ? ' is-lifted' : ''}`}>
      <div className="lp-nav-shell">
        <a className="lp-mark" href="#top">
          <span className="lp-mark-dot" aria-hidden />
          <span className="lp-mark-text">
            <span className="lp-mark-name">Vaani</span>
            <span className="lp-mark-sub">front desk</span>
          </span>
        </a>

        <div className="lp-nav-rail" ref={rail}>
          <span className="lp-nav-pill" ref={pill} aria-hidden />
          {LINKS.map((l) => (
            <a
              key={l.id}
              className={`lp-nav-link${active === l.id ? ' is-on' : ''}`}
              href={l.href}
              data-nav={l.id}
              aria-current={active === l.id ? 'true' : undefined}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="lp-nav-end">
          <a className="lp-nav-link lp-nav-quiet" href="/login">
            Sign in
          </a>
          <a className="lp-btn lp-btn-primary lp-btn-sm" href="/start">
            Set up your practice
          </a>
        </div>
      </div>
    </nav>
  )
}
