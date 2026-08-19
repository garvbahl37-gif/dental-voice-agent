import { describe, it, expect } from 'vitest'
import { InlineToolExtractor } from './inline-tools'

function run(chunks: string[]): { text: string; calls: { name: string; args: unknown }[] } {
  const x = new InlineToolExtractor()
  let text = ''
  const calls: { name: string; args: unknown }[] = []
  // Ids are generated, so assertions compare name and args only.
  const strip = (c: { name: string; args: unknown }) => ({ name: c.name, args: c.args })
  for (const c of chunks) {
    const out = x.push(c)
    text += out.text
    calls.push(...out.calls.map(strip))
  }
  const tail = x.flush()
  text += tail.text
  calls.push(...tail.calls.map(strip))
  return { text, calls }
}

describe('InlineToolExtractor', () => {
  it('passes ordinary text straight through', () => {
    expect(run(['Thursday at four is free.']).text).toBe('Thursday at four is free.')
  })

  it('extracts an inline call and keeps it out of the spoken text', () => {
    const r = run([
      'Let me check that for you. <function=check_availability>{"service": "scaling"}</function>',
    ])
    expect(r.text.trim()).toBe('Let me check that for you.')
    expect(r.calls).toEqual([{ name: 'check_availability', args: { service: 'scaling' } }])
  })

  it('never speaks markup when the tag is split across stream chunks', () => {
    // The failure this class exists to prevent: a caller hearing "less than
    // function equals".
    const r = run(['Checking now. <fun', 'ction=check_ava', 'ilability>{"serv', 'ice":"rct"}</fun', 'ction>'])
    expect(r.text).not.toContain('<')
    expect(r.text).not.toContain('function')
    expect(r.calls).toEqual([{ name: 'check_availability', args: { service: 'rct' } }])
  })

  it('holds back a partial opening tag rather than emitting it early', () => {
    const x = new InlineToolExtractor()
    expect(x.push('Okay <fun').text).toBe('Okay ')
    expect(x.push('ction=list_services>{}</function>').text).toBe('')
  })

  it('extracts several calls from one response', () => {
    const r = run([
      '<function=lookup_patient>{"phone":"9876543210"}</function> and <function=list_services>{}</function>',
    ])
    expect(r.calls.map((c) => c.name)).toEqual(['lookup_patient', 'list_services'])
  })

  it('recovers the call even when the arguments are malformed', () => {
    const r = run(['<function=list_services>{not json}</function>'])
    expect(r.calls).toEqual([{ name: 'list_services', args: {} }])
  })

  it('discards an unterminated tag rather than speaking a fragment', () => {
    const r = run(['Checking. <function=check_availability>{"service":"scal'])
    expect(r.text.trim()).toBe('Checking.')
    expect(r.calls).toEqual([])
  })

  it('leaves a lone angle bracket in normal speech alone', () => {
    expect(run(['The fee is < 2000 rupees.']).text).toBe('The fee is < 2000 rupees.')
  })

  it('handles text arriving one character at a time', () => {
    const src = 'Sure. <function=list_services>{}</function> Done.'
    const r = run(src.split(''))
    expect(r.text.replace(/\s+/g, ' ').trim()).toBe('Sure. Done.')
    expect(r.calls.map((c) => c.name)).toEqual(['list_services'])
  })
})
