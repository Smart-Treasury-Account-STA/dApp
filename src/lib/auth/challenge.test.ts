import { describe, expect, it } from 'vitest'

import {
  CHALLENGE_TTL_SECONDS,
  issueChallenge,
  verifyChallenge,
} from '@/lib/auth/challenge'

const SECRET = 'operator-token-under-test'
const ADDRESS = 'GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB'
const OTHER = 'GDU3LDGZOCJIB6MIKQWK5AICFFEWVC2FJ2BDEVXG37XXSKWIZ7OXVCAS'
const NOW = 1_757_500_000

describe('issueChallenge', () => {
  it('refuses to issue for anything but a Stellar account id', () => {
    expect(() => issueChallenge(SECRET, 'not-an-address')).toThrow(
      /Stellar account id/
    )
  })

  it('never issues the same challenge twice, even in the same second', () => {
    // Two challenges for one address in one second must not be
    // interchangeable, or a signature for the first would satisfy the second.
    const a = issueChallenge(SECRET, ADDRESS, NOW)
    const b = issueChallenge(SECRET, ADDRESS, NOW)
    expect(a).not.toBe(b)
  })
})

describe('verifyChallenge', () => {
  it('returns the address the challenge was issued for', () => {
    const challenge = issueChallenge(SECRET, ADDRESS, NOW)
    expect(verifyChallenge(SECRET, challenge, NOW)).toBe(ADDRESS)
  })

  it('still accepts it at the last second of its window', () => {
    const challenge = issueChallenge(SECRET, ADDRESS, NOW)
    expect(
      verifyChallenge(SECRET, challenge, NOW + CHALLENGE_TTL_SECONDS)
    ).toBe(ADDRESS)
  })

  it('rejects it one second later', () => {
    const challenge = issueChallenge(SECRET, ADDRESS, NOW)
    expect(
      verifyChallenge(SECRET, challenge, NOW + CHALLENGE_TTL_SECONDS + 1)
    ).toBeNull()
  })

  it('rejects a challenge minted with a different secret', () => {
    const forged = issueChallenge('another-secret', ADDRESS, NOW)
    expect(verifyChallenge(SECRET, forged, NOW)).toBeNull()
  })

  it('rejects an address swapped into a valid challenge', () => {
    // The address is inside the MAC'd body, so rewriting it invalidates the
    // whole thing -- otherwise anyone could turn their own challenge into a
    // challenge for someone else's address.
    const challenge = issueChallenge(SECRET, ADDRESS, NOW)
    expect(
      verifyChallenge(SECRET, challenge.replace(ADDRESS, OTHER), NOW)
    ).toBeNull()
  })

  it('rejects a challenge dated in the future', () => {
    const challenge = issueChallenge(SECRET, ADDRESS, NOW + 60)
    expect(verifyChallenge(SECRET, challenge, NOW)).toBeNull()
  })

  it('returns null, not a throw, for malformed input', () => {
    expect(verifyChallenge(SECRET, undefined, NOW)).toBeNull()
    expect(verifyChallenge(SECRET, '', NOW)).toBeNull()
    expect(verifyChallenge(SECRET, 'no-separator', NOW)).toBeNull()
    expect(verifyChallenge(SECRET, 'a.b', NOW)).toBeNull()
  })
})
