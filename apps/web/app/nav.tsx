'use client'

import { useEffect, useState } from 'react'

/**
 * The top bar, after Momo.
 *
 * The wordmark on the left, four links in the middle, and two actions on the
 * right: a quiet glass "Sign in" and the green "Get started". It sits on the
 * sky at the top of the page and, a few pixels down, lifts into a frosted
 * pill so the links stay readable over whatever scrolls under it.
 *
 * On a phone the links fold into a menu rather than wrapping into two rows.
 */

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '#needs', label: 'Use cases' },
  { href: '#voices', label: 'Example calls' },
  { href: '#languages', label: 'Languages' },
] as const

/**
 * `home` is false on the other marketing pages, where the section links have
 * to lead back to the landing page rather than to an anchor that is not there.
 */
export function Nav({ home = true }: { home?: boolean } = {}) {
  const to = (href: string) => (home || !href.startsWith('#') ? href : `/${href}`)
  const [lifted, setLifted] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`mo-nav${lifted ? ' is-lifted' : ''}`}>
      <div className="mo-nav-in">
        {/* How far down the page the reader is: a thin green line along the
            foot of the bar, filled by the scroll. */}
        <span className="mo-progress" aria-hidden />
        <a className="mo-logo" href={home ? '#top' : '/'}>
          Vaani
        </a>

        <div className="mo-nav-links">
          {LINKS.map((l) => (
            <a key={l.href} href={to(l.href)}>
              {l.label}
            </a>
          ))}
        </div>

        <div className="mo-nav-end">
          <a className="mo-btn is-glass is-sm" href="/login">
            Sign in
          </a>
          <a className="mo-btn is-green is-sm" href="/start">
            Get started
          </a>
          <button
            className="mo-burger"
            aria-label={menu ? 'Close the menu' : 'Open the menu'}
            aria-expanded={menu}
            aria-controls="mo-menu"
            onClick={() => setMenu((m) => !m)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>

      {menu && (
        <div className="mo-menu" id="mo-menu">
          {LINKS.map((l) => (
            <a key={l.href} href={to(l.href)} onClick={() => setMenu(false)}>
              {l.label}
            </a>
          ))}
          <a href="/login" onClick={() => setMenu(false)}>
            Sign in
          </a>
          <a className="mo-btn is-green" href="/start">
            Get started
          </a>
        </div>
      )}
    </nav>
  )
}
