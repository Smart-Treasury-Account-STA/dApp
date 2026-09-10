import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import { issueChallenge, verifyChallenge } from '@/lib/auth/challenge'
import { verifyWalletSignature } from '@/lib/auth/walletProof'

/**
 * The two halves compose the way `POST /api/relayer/session` composes them.
 * Each half is covered on its own; this is here because the mistake that
 * would slip past both is passing the wrong string to the second one -- the
 * body instead of the whole challenge, say -- which each unit test would
 * happily keep passing.
 */
const SECRET = 'operator-token-under-test'

function authenticate(challenge: string, signedMessage: string) {
  const address = verifyChallenge(SECRET, challenge)
  if (!address) return null
  return verifyWalletSignature(address, challenge, signedMessage)
    ? address
    : null
}

describe('challenge to session, end to end', () => {
  it('resolves to the address that signed the challenge it was given', () => {
    const wallet = Keypair.random()
    const challenge = issueChallenge(SECRET, wallet.publicKey())
    const signed = wallet.signMessage(challenge).toString('base64')

    expect(authenticate(challenge, signed)).toBe(wallet.publicKey())
  })

  it('refuses a challenge signed by a key other than the one it names', () => {
    // Requesting a challenge for someone else's address is allowed -- it is
    // useless, and this is why.
    const victim = Keypair.random()
    const attacker = Keypair.random()
    const challenge = issueChallenge(SECRET, victim.publicKey())
    const signed = attacker.signMessage(challenge).toString('base64')

    expect(authenticate(challenge, signed)).toBeNull()
  })

  it('refuses a signature over the challenge body without its MAC', () => {
    // The whole challenge is the message. Signing only the part before the
    // separator would leave the MAC unbound.
    const wallet = Keypair.random()
    const challenge = issueChallenge(SECRET, wallet.publicKey())
    const body = challenge.slice(0, challenge.lastIndexOf('.'))
    const signed = wallet.signMessage(body).toString('base64')

    expect(authenticate(challenge, signed)).toBeNull()
  })
})
