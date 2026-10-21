'use client'

import { usePathname, useRouter } from 'next/navigation'

/**
 * The bar across the top of every signed-in page.
 *
 * After CareFlow: a logo tile on the left, the pages as a row of icon-and-word
 * links with the current one filled in sage, and who is signed in on the
 * right. Their corner has a photograph; this one has initials, because nobody
 * signed up to have their face on a practice's screen.
 *
 * On a phone the links scroll sideways under the mark rather than wrapping
 * into three ragged lines above the thing you came to read.
 */

const LINKS: Array<{ href: string; label: string; icon: Icon }> = [
  { href: '/dashboard', label: 'Front desk', icon: 'grid' },
  { href: '/knowledge', label: 'Knowledge', icon: 'book' },
  { href: '/settings', label: 'Settings', icon: 'gear' },
  { href: '/console', label: 'Take a call', icon: 'phone' },
]

type Icon = 'grid' | 'book' | 'gear' | 'phone' | 'out'

/**
 * `guest` is for the console, which anyone can open from the landing page:
 * there is nobody to sign out, so the corner offers to sign in instead.
 */
export function AppBar({ who, role, guest = false }: { who?: string; role?: string; guest?: boolean }) {
  const path = usePathname()
  const router = useRouter()
  const initials = (who ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

  return (
    <nav className="ab" aria-label="Practice">
      <a className="ab-mark" href="/dashboard">
        <span className="ab-tile" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 12h4l2-5 3 10 3-8 2 3h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        Vaani
      </a>

      <div className="ab-rail">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className={`ab-link${path === l.href ? ' is-on' : ''}`}
            aria-current={path === l.href ? 'page' : undefined}
          >
            <Glyph name={l.icon} />
            {l.label}
          </a>
        ))}
      </div>

      <div className="ab-end">
        {who && (
          <span className="ab-who">
            <span className="ab-initials" aria-hidden>
              {initials || '·'}
            </span>
            <span className="ab-who-text">
              <strong>{who}</strong>
              {role && <small>{role}</small>}
            </span>
          </span>
        )}
        {guest ? (
          <a className="ab-signin" href="/login">
            Sign in
          </a>
        ) : (
          <button
            className="ab-out"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await fetch('/api/auth', { method: 'DELETE' })
              router.push('/login')
            }}
          >
            <Glyph name="out" />
          </button>
        )}
      </div>
    </nav>
  )
}

function Glyph({ name }: { name: Icon }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const d: Record<Icon, React.ReactNode> = {
    grid: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" {...p} />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" {...p} />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" {...p} />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" {...p} />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5z" {...p} />
        <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z" {...p} />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" {...p} />
        <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" {...p} />
      </>
    ),
    phone: (
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        {...p}
      />
    ),
    out: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" {...p} />,
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      {d[name]}
    </svg>
  )
}
