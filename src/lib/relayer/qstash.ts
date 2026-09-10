import { Receiver } from '@upstash/qstash'

import { requireRelayerAdmin } from '@/lib/relayer/auth'

/** Header QStash signs every delivery with (a JWT over the body hash). */
export const QSTASH_SIGNATURE_HEADER = 'upstash-signature'

/** Who authorized a relayer run: the QStash schedule or a human operator. */
export type RelayerTrigger = 'qstash' | 'operator'

/**
 * Authorizes a `POST /api/relayer/run`, from either of its two callers.
 *
 * A request carrying `Upstash-Signature` is treated as a QStash delivery and
 * nothing else: the signature must verify against the configured signing
 * keys (current, then next, so a key rotation in the QStash console never
 * causes a missed run), over the raw body QStash hashed, and -- when
 * `QSTASH_RELAYER_RUN_URL` is set -- for that exact destination. An operator
 * token on the same request cannot rescue a bad signature; QStash never
 * sends one, so its presence alongside a signature is not a shape this
 * endpoint recognizes.
 *
 * A request without the header falls back to the operator credentials
 * `requireRelayerAdmin` already accepts: the `x-relayer-token` header (the
 * CLI runner) or an operator-subject session cookie (the console).
 *
 * `rawBody` must be the body exactly as received (`await request.text()`),
 * never a re-serialized JSON object -- the signature commits to the bytes.
 *
 * The destination pin deliberately reads an env var rather than
 * `request.url`: in production the marketing site proxies `/app/*` to this
 * deployment, so the URL the function sees is not the URL the schedule was
 * registered with, and pinning on it would reject every legitimate run.
 */
export async function requireRelayerTrigger(
  request: Request,
  rawBody: string
): Promise<RelayerTrigger> {
  const signature = request.headers.get(QSTASH_SIGNATURE_HEADER)
  if (!signature) {
    requireRelayerAdmin(request)
    return 'operator'
  }

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey) {
    throw new Error(
      'QSTASH_CURRENT_SIGNING_KEY must be configured before QStash can trigger the relayer.'
    )
  }

  const receiver = new Receiver({
    currentSigningKey,
    nextSigningKey,
    // Never pick up the QStash dev server's keys from a stray QSTASH_DEV env
    // var: a production deployment must only trust the console's keys.
    devMode: false,
  })
  const pinnedUrl = process.env.QSTASH_RELAYER_RUN_URL?.trim() || undefined

  const valid = await receiver
    .verify({
      signature,
      body: rawBody,
      url: pinnedUrl,
      // QStash's clock and Vercel's are not the same clock.
      clockTolerance: 5,
    })
    .catch(() => false)

  if (!valid) {
    throw new Error('Unauthorized relayer request.')
  }
  return 'qstash'
}
