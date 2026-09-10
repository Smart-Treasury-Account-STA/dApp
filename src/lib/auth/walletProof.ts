import { Keypair } from '@stellar/stellar-sdk'

const ED25519_SIGNATURE_BYTES = 64

/**
 * Whether `signedMessage` is a signature over `message` by `address`.
 *
 * `signedMessage` is what SEP-43's `signMessage` hands back, base64 encoded.
 * The wallet does not sign the message bytes themselves: per SEP-53 it signs
 * `SHA-256("Stellar Signed Message:\n" + message)`, which is what Freighter's
 * `encodeSep53Message` produces and what `Keypair.verifyMessage` checks.
 * Verifying the raw bytes instead rejects every genuine Freighter signature
 * -- found the hard way, on mainnet, on 2026-09-10.
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
 *
 * The length is checked before verifying so a wallet that returns something
 * other than the 64 signature bytes surfaces as that, not as a key mismatch
 * that would send whoever debugs it looking in the wrong place.
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
    return Keypair.fromPublicKey(address).verifyMessage(message, signature)
  } catch {
    // fromPublicKey throws on a malformed strkey.
    return false
  }
}
