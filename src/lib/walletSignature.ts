import { Buffer } from 'buffer'

const ED25519_SIGNATURE_BYTES = 64

/**
 * Decodes the signature a wallet returned for an authorization entry into its
 * raw ed25519 bytes.
 *
 * `@creit.tech/stellar-wallets-kit` normalizes Freighter's reply with
 * `Buffer.from(signedAuthEntry).toString("base64")`, which assumes
 * `@stellar/freighter-api` resolves with a Buffer. Freighter 5.x resolves with
 * a base64 *string*, so that call encodes the characters of a base64 string
 * and the signature arrives wrapped in a second base64 layer — 88 bytes of
 * text where 64 bytes of signature belong. `authorizeEntry` then fails its own
 * `Keypair.verify` with "signature doesn't match payload", which reads like a
 * key or payload mismatch and says nothing about encoding.
 *
 * Unwrapping is keyed on the decoded length rather than the wallet's identity,
 * so a wallet that encodes correctly passes straight through and this keeps
 * working if the kit fixes its side.
 */
export function decodeWalletSignature(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === ED25519_SIGNATURE_BYTES) {
    return decoded
  }

  const unwrapped = Buffer.from(decoded.toString('utf8'), 'base64')
  if (unwrapped.length === ED25519_SIGNATURE_BYTES) {
    return unwrapped
  }

  throw new Error(
    `Wallet returned ${decoded.length} bytes where a 64-byte ed25519 signature was expected.`
  )
}
