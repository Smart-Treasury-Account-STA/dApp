import { describe, expect, it } from 'vitest'

import {
  OPERATOR_SUBJECT,
  createSessionValue,
  readSessionSubject,
  verifySessionValue,
} from '@/lib/relayer/session'

const token = 'correct-horse-battery-staple'
const now = 1_800_000_000

describe('relayer session value', () => {
  it('verifies a freshly created value', () => {
    const value = createSessionValue(token, OPERATOR_SUBJECT, now)
    expect(verifySessionValue(token, value, now + 60)).toBe(true)
  })

  it('rejects an expired value', () => {
    const value = createSessionValue(token, OPERATOR_SUBJECT, now)
    expect(verifySessionValue(token, value, now + 60 * 60 * 24)).toBe(false)
  })

  it('rejects a value signed with a different admin token', () => {
    const value = createSessionValue('other-token', OPERATOR_SUBJECT, now)
    expect(verifySessionValue(token, value, now + 60)).toBe(false)
  })

  it('rejects a tampered expiry', () => {
    const value = createSessionValue(token, OPERATOR_SUBJECT, now)
    const [subject, , mac] = value.split('.')
    expect(
      verifySessionValue(token, `${subject}.${now + 999_999}.${mac}`, now + 60)
    ).toBe(false)
  })

  it('rejects a subject swapped into someone else’s session', () => {
    // The subject is inside the MAC'd payload precisely so this fails: an
    // operator session must not be reshapeable into an address session, nor
    // one address into another.
    const value = createSessionValue(token, OPERATOR_SUBJECT, now)
    const [, expiry, mac] = value.split('.')
    expect(
      readSessionSubject(token, `GSOMEONEELSE.${expiry}.${mac}`, now + 60)
    ).toBeNull()
  })

  it('reports the address a wallet session belongs to', () => {
    const address = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'
    const value = createSessionValue(token, address, now)
    expect(readSessionSubject(token, value, now + 60)).toBe(address)
    // ...and it is not an operator session, which is what gates the routes
    // that still require the admin token.
    expect(verifySessionValue(token, value, now + 60)).toBe(false)
  })

  it('rejects a malformed value', () => {
    expect(verifySessionValue(token, 'garbage', now)).toBe(false)
    expect(verifySessionValue(token, undefined, now)).toBe(false)
  })
})
