/**
 * Whether a treasury can actually move an asset, separate from whether policy
 * would allow it.
 *
 * These are different gates and they fail at different layers. Policy is this
 * project's own `policy_engine`; this is the token contract's own bookkeeping,
 * which rejects long before any treasury logic runs. Nothing in the treasury's
 * status (`initialized`/`paused`/`frozen`) reflects it, so an unfunded
 * treasury and one the issuer has not authorized look identical until a
 * payment fails.
 */

export type AssetHolding = {
  /** Balance in stroops, or null when the holder has no balance entry at all. */
  balance: bigint | null
  /** The token's authorization flag, or null when there is no balance entry. */
  authorized: boolean | null
  /** True when the token reported no trustline / balance entry (#13). */
  missing: boolean
}

export type AssetReadiness =
  | { ready: true }
  | {
      ready: false
      reason: 'missing' | 'deauthorized' | 'empty' | 'insufficient'
      message: string
    }

/**
 * Reports the first reason this holder cannot send `amount` of the asset.
 *
 * Ordered the way the token itself fails, so the message always names the
 * blocker the operator would hit next rather than a later one: a missing
 * balance entry (#13) is checked before authorization (#11), which is checked
 * before the balance itself (#10). Reporting "balance too low" to someone
 * whose trustline is not authorized would send them to fund an account that
 * still could not receive.
 *
 * `amount` is optional: without it this answers "could this holder send
 * anything at all", which is what a status panel wants.
 */
export function describeAssetReadiness(
  holding: AssetHolding,
  amount?: bigint
): AssetReadiness {
  if (holding.missing) {
    return {
      ready: false,
      reason: 'missing',
      message:
        'No trustline for this asset. A classic account has to create it from its own wallet — the issuer cannot create one on its behalf.',
    }
  }

  if (holding.authorized === false) {
    return {
      ready: false,
      reason: 'deauthorized',
      message:
        "This asset's issuer requires authorization and has not granted it here yet. No payment of this asset can succeed until the issuer authorizes this address.",
    }
  }

  const balance = holding.balance ?? 0n

  if (balance <= 0n) {
    return {
      ready: false,
      reason: 'empty',
      message:
        'The balance of this asset is zero, so there is nothing to send.',
    }
  }

  if (amount !== undefined && amount > balance) {
    return {
      ready: false,
      reason: 'insufficient',
      message: `This payment needs ${amount} but the balance is ${balance}.`,
    }
  }

  return { ready: true }
}

/** Sums a split's per-destination amounts, ignoring entries that are not yet a
 * valid number -- a half-typed form must not read as a huge total and block
 * the button for the wrong reason. */
export function totalRequested(amounts: string[]): bigint {
  let total = 0n
  for (const raw of amounts) {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) continue
    total += BigInt(trimmed)
  }
  return total
}
