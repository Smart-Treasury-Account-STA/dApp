import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import { verifyWalletSignature } from '@/lib/auth/walletProof'

const keypair = Keypair.random()
const ADDRESS = keypair.publicKey()
const MESSAGE = 'sta-auth:GABC:1757500000:deadbeef.abc123'

/** What a SEP-43 wallet returns: the SEP-53 signature, base64 encoded. */
function sign(message: string, signer = keypair) {
  return signer.signMessage(message).toString('base64')
}

describe('verifyWalletSignature', () => {
  it('accepts a signature the address really produced', () => {
    expect(verifyWalletSignature(ADDRESS, MESSAGE, sign(MESSAGE))).toBe(true)
  })

  it('accepts the SEP-53 reference vector, independent of this SDK', () => {
    // Test vector from the SEP-53 text itself, recomputed locally before
    // being written down. Pins the verifier to the standard Freighter
    // implements, not merely to whatever Keypair.signMessage does today.
    const signer = Keypair.fromSecret(
      'SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW'
    )
    expect(
      verifyWalletSignature(
        signer.publicKey(),
        'Hello, World!',
        'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA=='
      )
    ).toBe(true)
  })

  it('rejects a signature over the raw message bytes', () => {
    // The bug this file exists to prevent: a wallet signs the SEP-53 hash,
    // so a verifier that checks the raw bytes -- and a signer that produces
    // them -- disagree with every real wallet.
    const raw = keypair.sign(Buffer.from(MESSAGE, 'utf8')).toString('base64')
    expect(verifyWalletSignature(ADDRESS, MESSAGE, raw)).toBe(false)
  })

  it('rejects a signature over a different message', () => {
    expect(
      verifyWalletSignature(ADDRESS, MESSAGE, sign(`${MESSAGE}-tampered`))
    ).toBe(false)
  })

  it('rejects a valid signature from another key', () => {
    // The whole point: the proof must bind to the claimed address, not merely
    // be well formed.
    expect(
      verifyWalletSignature(ADDRESS, MESSAGE, sign(MESSAGE, Keypair.random()))
    ).toBe(false)
  })

  it('rejects anything that is not 64 bytes of signature', () => {
    // A wallet returning the signed payload instead of the signature lands
    // here, and must not be reported as a key mismatch.
    expect(
      verifyWalletSignature(
        ADDRESS,
        MESSAGE,
        Buffer.from(MESSAGE).toString('base64')
      )
    ).toBe(false)
    expect(verifyWalletSignature(ADDRESS, MESSAGE, '')).toBe(false)
    expect(verifyWalletSignature(ADDRESS, MESSAGE, undefined)).toBe(false)
  })

  it('rejects a malformed address instead of throwing', () => {
    expect(
      verifyWalletSignature('not-an-address', MESSAGE, sign(MESSAGE))
    ).toBe(false)
  })
})
