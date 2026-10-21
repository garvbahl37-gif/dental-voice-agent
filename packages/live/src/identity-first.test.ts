import { describe, expect, it } from 'vitest'
import { identityFirst } from './session'

/**
 * Live asked for a booking and the new patient it was for in one batch,
 * booking first; run in that order the booking was refused for want of a
 * patient. Finding or registering the caller now always runs first.
 */
describe('identityFirst', () => {
  it('runs patient lookups before a booking sent ahead of them', () => {
    const order = identityFirst([
      { name: 'book_appointment' },
      { name: 'create_patient' },
    ]).map((c) => c.name)
    expect(order).toEqual(['create_patient', 'book_appointment'])
  })

  it('keeps everything else in the order it was asked for', () => {
    const order = identityFirst([
      { name: 'check_availability' },
      { name: 'search_knowledge' },
      { name: 'lookup_patient' },
      { name: 'list_services' },
    ]).map((c) => c.name)
    expect(order).toEqual(['lookup_patient', 'check_availability', 'search_knowledge', 'list_services'])
  })
})
