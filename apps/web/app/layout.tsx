import type { Metadata } from 'next'
import {
  Fraunces,
  Familjen_Grotesk,
  JetBrains_Mono,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Bengali,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
  Noto_Sans_Kannada,
  Noto_Sans_Malayalam,
  Noto_Sans_Gurmukhi,
} from 'next/font/google'
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

/**
 * One family per script.
 *
 * A Latin stack renders Tamil or Malayalam as tofu, and stacks Devanagari
 * matras badly — which a caller reads as a broken app rather than a missing
 * font. Each is self-hosted at build time by next/font, so the transcript
 * renders correctly offline too.
 */
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  variable: '--font-noto-deva',
  display: 'swap',
})

const gujarati = Noto_Sans_Gujarati({ subsets: ['gujarati'], variable: '--font-noto-gujr', display: 'swap' })
const bengali = Noto_Sans_Bengali({ subsets: ['bengali'], variable: '--font-noto-beng', display: 'swap' })
const tamil = Noto_Sans_Tamil({ subsets: ['tamil'], variable: '--font-noto-taml', display: 'swap' })
const telugu = Noto_Sans_Telugu({ subsets: ['telugu'], variable: '--font-noto-telu', display: 'swap' })
const kannada = Noto_Sans_Kannada({ subsets: ['kannada'], variable: '--font-noto-knda', display: 'swap' })
const malayalam = Noto_Sans_Malayalam({ subsets: ['malayalam'], variable: '--font-noto-mlym', display: 'swap' })
const gurmukhi = Noto_Sans_Gurmukhi({ subsets: ['gurmukhi'], variable: '--font-noto-guru', display: 'swap' })

export const metadata: Metadata = {
  title: 'Vaani — AI front desk',
  description: 'Multilingual voice agent for dental practices. Hindi, English, and Hinglish.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={[
        display.variable, ui.variable, mono.variable, devanagari.variable,
        gujarati.variable, bengali.variable, tamil.variable, telugu.variable,
        kannada.variable, malayalam.variable, gurmukhi.variable,
      ].join(' ')}
    >
      <body>{children}</body>
    </html>
  )
}
