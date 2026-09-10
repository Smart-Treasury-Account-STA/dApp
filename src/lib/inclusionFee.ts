import type { rpc } from '@stellar/stellar-sdk'

/**
 * What this dApp bids, in stroops, for a transaction to be included in a
 * ledger. `prepareTransaction` adds the simulated resource fee on top of
 * whatever the builder was given (SDK `assembleTransaction`: `fee =
 * tx.fee + minResourceFee`), so this number is only ever the inclusion
 * half of the total.
 *
 * The dApp used to bid `BASE_FEE` -- 100 stroops, the protocol minimum.
 * That is enough on testnet, which never fills a ledger, and not enough on
 * mainnet, whose Soroban ledgers are saturated: every percentile of
 * `getFeeStats().sorobanInclusionFee` sat at 200 stroops when this was
 * written, so a 100-stroop bid lost surge pricing and the network rejected
 * the transaction outright with `txInsufficientFee`. That is what made
 * `account_factory.deploy_account` unusable on mainnet.
 *
 * The two failure directions are wildly asymmetric, so the bid is
 * deliberately generous. Bidding too little fails the submission after the
 * wallet has already collected every authorization prompt -- six of them for
 * a deploy -- and the whole ceremony has to be repeated. Bidding too much
 * costs at most the bid itself, which the cap below holds under 0.01 XLM.
 *
 * Only transactions that get submitted need this. The builds that exist
 * purely to be simulated -- auth discovery, read-only contract calls --
 * still use `BASE_FEE`, because a simulation is never bid on and giving
 * those a market rate would just be noise.
 */

/**
 * Bid when the RPC cannot say what the market is: ten times the mainnet
 * rate observed when this was written, and also the lower bound on every
 * computed bid, so a quiet network reporting `"0"` percentiles cannot talk
 * the dApp back down to a losing bid.
 */
const FLOOR_STROOPS = 2_000

/** 0.01 XLM. Nothing this dApp does is worth more than that to include. */
const CAP_STROOPS = 100_000

/** Multiple of the observed rate, to survive a surge that starts after the
 * fee was read but before the wallet finishes signing. */
const HEADROOM = 10

export async function inclusionFee(server: rpc.Server): Promise<string> {
  let observed = 0
  try {
    const stats = await server.getFeeStats()
    const p99 = Number.parseInt(stats.sorobanInclusionFee.p99, 10)
    observed = Number.isFinite(p99) ? p99 : 0
  } catch {
    // An RPC too old for getFeeStats, or momentarily unreachable, is not a
    // reason to fail a transaction the user has not been asked to sign yet
    // -- fall through to the floor, which is already above market.
    observed = 0
  }

  const bid = Math.min(
    CAP_STROOPS,
    Math.max(FLOOR_STROOPS, observed * HEADROOM)
  )
  return String(bid)
}
