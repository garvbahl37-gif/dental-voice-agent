import type { Metadata } from 'next'
import { Fraunces, Familjen_Grotesk, JetBrains_Mono, Noto_Sans_Devanagari } from 'next/font/google'
import './globals.css'

/**
 * Four faces, each doing one job.
 *
 * The serif/grotesk split is the thesis rendered in type: the desk's speech is
 * set in the warm editorial face and the caller's in the neutral one, because
 * the product's whole task is making the machine read as the human. Devanagari
 * gets its own family — Latin faces render matras badly or fall back
 * inconsistently across platforms.
 *
 * Self-hosted at build time via next/font, so the console still renders
 * correctly on the offline local tier.
 */

// Fraunces is a variable serif with real optical sizing — it stays warm and
// humane at display sizes and legible in the transcript, which is what a
// product about sounding human should be set in.
const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
})

const ui = Familjen_Grotesk({
  subsets: ['latin'],
  variable: '--font-familjen',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-face',
  display: 'swap',
})

const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  variable: '--font-noto-deva',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Vaani — AI front desk',
  description: 'Multilingual voice agent for dental practices. Hindi, English, and Hinglish.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${ui.variable} ${mono.variable} ${devanagari.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
