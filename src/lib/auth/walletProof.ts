import { Keypair } from '@stellar/stellar-sdk'

const ED25519_SIGNATURE_BYTES = 64

/**
 * Whether `signedMessage` is a signature over `message` by `address`.
 *
 * `signedMessage` is what SEP-43's `signMessage` hands back, base64 encoded.
 * Wallets disagree about what they put in it -- the signature bytes, or the
 * signed payload -- so the length is checked before verifying rather than
 * letting a wallet that returns the wrong thing surface as "bad signature",
 * which would send whoever debugs it looking for a key mismatch that isn't
 * there.
 *
 * Returns false rather than throwing on anything malformed: a bad proof is an
 * ordinary unauthenticated request.
 */
export function verifyWalletSignature(
  address: string,
  message: string,
  signedMessage: string | undefined
): boolean {
  if (!signedMessage) return false

  let signature: Buffer
  try {
    signature = Buffer.from(signedMessage, 'base64')
  } catch {
    return false
  }
  if (signature.length !== ED25519_SIGNATURE_BYTES) return false

  try {
    return Keypair.fromPublicKey(address).verify(
      Buffer.from(message, 'utf8'),
      signature
    )
  } catch {
    // fromPublicKey throws on a malformed strkey.
    return false
  }
}
