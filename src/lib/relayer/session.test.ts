import { describe, expect, it } from 'vitest'

import { createSessionValue, readSessionSubject } from '@/lib/relayer/session'

const token = 'correct-horse-battery-staple'
const now = 1_800_000_000
const ADDRESS = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'
const OTHER = 'GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS'

describe('relayer session value', () => {
  it('reports the address a freshly created value belongs to', () => {
    const value = createSessionValue(token, ADDRESS, now)
    expect(readSessionSubject(token, value, now + 60)).toBe(ADDRESS)
  })

  it('rejects an expired value', () => {
    const value = createSessionValue(token, ADDRESS, now)
    expect(readSessionSubject(token, value, now + 60 * 60 * 24)).toBeNull()
  })

  it('rejects a value signed with a different admin token', () => {
    const value = createSessionValue('other-token', ADDRESS, now)
    expect(readSessionSubject(token, value, now + 60)).toBeNull()
  })

  it('rejects a tampered expiry', () => {
    const value = createSessionValue(token, ADDRESS, now)
    const [subject, , mac] = value.split('.')
    expect(
      readSessionSubject(token, `${subject}.${now + 999_999}.${mac}`, now + 60)
    ).toBeNull()
  })

  it('rejects a subject swapped into someone else’s session', () => {
    // The subject is inside the MAC'd payload precisely so this fails: one
    // address must not be reshapeable into another.
    const value = createSessionValue(token, ADDRESS, now)
    const [, expiry, mac] = value.split('.')
    expect(
      readSessionSubject(token, `${OTHER}.${expiry}.${mac}`, now + 60)
    ).toBeNull()
  })

  it('refuses a subject that would break the field separator', () => {
    expect(() => createSessionValue(token, 'a.b', now)).toThrow(
      'A session subject cannot contain the field separator.'
    )
  })

  it('rejects a malformed value', () => {
    expect(readSessionSubject(token, 'garbage', now)).toBeNull()
    expect(readSessionSubject(token, undefined, now)).toBeNull()
  })
})
