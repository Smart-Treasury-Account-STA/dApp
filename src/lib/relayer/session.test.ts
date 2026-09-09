import { describe, expect, it } from 'vitest'

import { createSessionValue, verifySessionValue } from '@/lib/relayer/session'

const token = 'correct-horse-battery-staple'
const now = 1_800_000_000

describe('relayer session value', () => {
  it('verifies a freshly created value', () => {
    const value = createSessionValue(token, now)
    expect(verifySessionValue(token, value, now + 60)).toBe(true)
  })

  it('rejects an expired value', () => {
    const value = createSessionValue(token, now)
    expect(verifySessionValue(token, value, now + 60 * 60 * 24)).toBe(false)
  })

  it('rejects a value signed with a different admin token', () => {
    const value = createSessionValue('other-token', now)
    expect(verifySessionValue(token, value, now + 60)).toBe(false)
  })

  it('rejects a tampered expiry', () => {
    const value = createSessionValue(token, now)
    const [, mac] = value.split('.')
    expect(verifySessionValue(token, `${now + 999_999}.${mac}`, now + 60)).toBe(
      false
    )
  })

  it('rejects a malformed value', () => {
    expect(verifySessionValue(token, 'garbage', now)).toBe(false)
    expect(verifySessionValue(token, undefined, now)).toBe(false)
  })
})
