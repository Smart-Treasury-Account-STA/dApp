import { STELLAR_CONFIG } from '@/config'

/**
 * The account a read-only probe builds its simulated transaction from.
 *
 * `simulatePolicy`, `simulateTransfer` and `checkNonce` all reach the chain
 * through `simulateContractCall`, which needs a transaction, which needs a
 * source account the RPC can return a sequence number for. That is the whole
 * job: none of the three ever passes this address to the contract -- the
 * arguments are the draft's asset, destination, amount, nonce and expected
 * policy version -- so the answer is the same whoever asks.
 *
 * A connected wallet is the obvious source. Before one connects there is no
 * candidate at all, and the configured default destination stands in purely
 * because it is an address the network already knows. Nothing about the
 * result depends on that choice.
 */
export function simulationSourceAddress(walletAddress: string | null): string {
  return walletAddress ?? STELLAR_CONFIG.defaultDestination
}
