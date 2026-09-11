import { Keypair, hash, xdr } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import { buildClassicAuthEntry, buildInvocation } from 'sta-sdk'
import { describe, expect, it } from 'vitest'

import type { WalletSigning } from '@/types'

import { signEnvelope, walletSigningCallback } from './stellarClient'

const CONTRACT = 'CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS'

/**
 * Behaves like Freighter: it parses whatever it is handed strictly as a
 * `HashIdPreimage`, signs `hash(preimage.toXDR())`, and returns the raw
 * signature in base64 — not an authorization entry.
 *
 * Handing it a `SorobanAuthorizationEntry` makes the parse throw, which is the
 * production failure ("Invalid Authorization Entry — the authorization entry
 * XDR could not be parsed") reproduced here without a browser.
 */
function freighterLikeWallet(keypair: Keypair): WalletSigning {
  return {
    address: keypair.publicKey(),
    async signAuthEntry(authEntryXdr: string) {
      const preimage = xdr.HashIdPreimage.fromXDR(authEntryXdr, 'base64')
      const signature = keypair.sign(hash(preimage.toXDR()))
      return {
        // Double-encoded, exactly as the wallets kit delivers it: it calls
        // `Buffer.from(signedAuthEntry).toString("base64")` on a value
        // Freighter already returned as a base64 string.
        signature: Buffer.from(signature.toString('base64')).toString('base64'),
        signerAddress: keypair.publicKey(),
      }
    },
    async signTransaction() {
      throw new Error('signTransaction is not part of this path.')
    },
  }
}

/**
 * Reproduces the production bug: Freighter reports (via `signerAddress`)
 * that it actually signed with a different account than the one the wallet
 * was asked to sign with — e.g. the extension's active account didn't match
 * the requested `accountToSign`. The signature it returns is real, valid,
 * and *matches `wrongSigner`* — but plugging `wallet.address` in as the
 * verification key instead of the account that actually signed makes
 * `authorizeEntry`'s `Keypair.verify` fail with the SDK's generic
 * "signature doesn't match payload", which gives no hint that the wrong
 * account signed.
 */
function wrongAccountWallet(
  expectedAddress: string,
  wrongSigner: Keypair
): WalletSigning {
  return {
    address: expectedAddress,
    async signAuthEntry(authEntryXdr: string) {
      const preimage = xdr.HashIdPreimage.fromXDR(authEntryXdr, 'base64')
      const signature = wrongSigner.sign(hash(preimage.toXDR()))
      return {
        signature: Buffer.from(signature.toString('base64')).toString('base64'),
        signerAddress: wrongSigner.publicKey(),
      }
    },
    async signTransaction() {
      throw new Error('signTransaction is not part of this path.')
    },
  }
}

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'

/** The nested `__check_auth` call a delegated signer authorizes -- what the
 * SDK's Entry B is rooted at. */
function checkAuthInvocation() {
  return buildInvocation({
    contractId: CONTRACT,
    functionName: '__check_auth',
    args: [xdr.ScVal.scvU32(1)],
  })
}

/**
 * The SDK builds and signs the entry; this dApp only supplies the wallet as
 * a `SigningCallback`. So the callback is exercised through the SDK's own
 * `buildClassicAuthEntry` -- the same call its Entry B makes -- rather than
 * in isolation, because what matters is that the pair produces an entry
 * `authorizeEntry` accepts.
 */
describe('walletSigningCallback', () => {
  const keypair = Keypair.random()
  const expirationLedger = 5_000_000

  it('hands the wallet a preimage it can parse', async () => {
    await expect(
      buildClassicAuthEntry(
        keypair.publicKey(),
        checkAuthInvocation(),
        walletSigningCallback(freighterLikeWallet(keypair)),
        expirationLedger,
        NETWORK_PASSPHRASE
      )
    ).resolves.toBeDefined()
  })

  it('returns an entry carrying a real signature', async () => {
    const signed = await buildClassicAuthEntry(
      keypair.publicKey(),
      checkAuthInvocation(),
      walletSigningCallback(freighterLikeWallet(keypair)),
      expirationLedger,
      NETWORK_PASSPHRASE
    )

    const credentials = signed.credentials().address()
    expect(credentials.signatureExpirationLedger()).toBe(expirationLedger)
    // An unsigned entry carries a void signature; a signed one carries a vec.
    expect(credentials.signature().vec()?.length ?? 0).toBeGreaterThan(0)
  })

  it('preserves the invocation the signer approved', async () => {
    const invocation = checkAuthInvocation()
    const signed = await buildClassicAuthEntry(
      keypair.publicKey(),
      invocation,
      walletSigningCallback(freighterLikeWallet(keypair)),
      expirationLedger,
      NETWORK_PASSPHRASE
    )

    expect(signed.rootInvocation().toXDR('base64')).toBe(
      invocation.toXDR('base64')
    )
  })

  it('fails loudly when the wallet returns nothing', async () => {
    const silentWallet: WalletSigning = {
      address: keypair.publicKey(),
      async signAuthEntry() {
        return undefined
      },
      async signTransaction() {
        return undefined
      },
    }

    await expect(
      buildClassicAuthEntry(
        keypair.publicKey(),
        checkAuthInvocation(),
        walletSigningCallback(silentWallet),
        expirationLedger,
        NETWORK_PASSPHRASE
      )
    ).rejects.toThrow(/did not return a signed authorization entry/i)
  })

  it('fails with an actionable message when the wallet signs with a different account', async () => {
    const wrongSigner = Keypair.random()

    await expect(
      buildClassicAuthEntry(
        keypair.publicKey(),
        checkAuthInvocation(),
        walletSigningCallback(
          wrongAccountWallet(keypair.publicKey(), wrongSigner)
        ),
        expirationLedger,
        NETWORK_PASSPHRASE
      )
    ).rejects.toThrow(
      new RegExp(
        `${wrongSigner.publicKey()}.*instead of.*${keypair.publicKey()}`,
        'i'
      )
    )
  })
})

describe('signEnvelope', () => {
  const EXPECTED = 'GEXPECTED0000000000000000000000000000000000000000000000'
  const WRONG = 'GWRONG00000000000000000000000000000000000000000000000000'

  function wallet(
    signTransaction: WalletSigning['signTransaction']
  ): WalletSigning {
    return {
      address: EXPECTED,
      async signAuthEntry() {
        throw new Error('signAuthEntry is not part of this path.')
      },
      signTransaction,
    }
  }

  it('returns the signed xdr when the wallet signs with the expected account', async () => {
    const w = wallet(async () => ({
      xdr: 'signed-xdr',
      signerAddress: EXPECTED,
    }))

    await expect(signEnvelope(w, 'unsigned-xdr')).resolves.toBe('signed-xdr')
  })

  it("treats a missing signerAddress as the expected signer, for wallet kits that don't report one", async () => {
    const w = wallet(async () => ({ xdr: 'signed-xdr' }))

    await expect(signEnvelope(w, 'unsigned-xdr')).resolves.toBe('signed-xdr')
  })

  it('fails with an actionable message when the wallet signs with a different account', async () => {
    // Same production bug as signDelegatedAuthEntry above, one layer up:
    // the envelope signature. Freighter's active account didn't match the
    // one requested, and this is the only signature check at all for a
    // source-account-strategy write -- no custom AuthPayload to catch it
    // another way.
    const w = wallet(async () => ({ xdr: 'signed-xdr', signerAddress: WRONG }))

    await expect(signEnvelope(w, 'unsigned-xdr')).rejects.toThrow(
      new RegExp(`${WRONG}.*instead of.*${EXPECTED}`, 'i')
    )
  })

  it('fails loudly when the wallet returns nothing', async () => {
    const w = wallet(async () => undefined)

    await expect(signEnvelope(w, 'unsigned-xdr')).rejects.toThrow(
      /did not return a signed transaction envelope/i
    )
  })
})
