import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import { verifyWalletSignature } from '@/lib/auth/walletProof'

const keypair = Keypair.random()
const ADDRESS = keypair.publicKey()
const MESSAGE = 'sta-auth:GABC:1757500000:deadbeef.abc123'

function sign(message: string, signer = keypair) {
  return signer.sign(Buffer.from(message, 'utf8')).toString('base64')
}

describe('verifyWalletSignature', () => {
  it('accepts a signature the address really produced', () => {
    expect(verifyWalletSignature(ADDRESS, MESSAGE, sign(MESSAGE))).toBe(true)
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
