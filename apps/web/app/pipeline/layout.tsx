import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The pipeline — Vaani',
  description: 'How a call goes through Vaani, end to end: the line, the model, the tools, the triage rules, the record and your dashboard.',
}

export default function PipelineLayout({ children }: { children: React.ReactNode }) {
  return children
}
