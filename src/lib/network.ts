import { Networks } from '@stellar/stellar-sdk'

/**
 * Which Stellar network the app is pointed at, derived from the configured
 * network passphrase.
 *
 * The passphrase is the single source of truth on purpose: it is already
 * required and validated (`NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`), it is
 * what every transaction is signed against, and it is what the wallet kit is
 * handed. A separate "network name" variable could drift and label a testnet
 * deployment "mainnet"; this cannot.
 *
 * The passphrase constants come from the SDK's `Networks` enum rather than
 * being copied here, so a literal can never fall out of step with the value
 * the SDK actually signs with. The wallet kit's own `WalletNetwork` enum
 * carries the same strings.
 */

export type StellarNetworkId = 'mainnet' | 'testnet' | 'futurenet' | 'custom'

export type StellarNetwork = {
  id: StellarNetworkId
  /** Bare name, for mid-sentence use: "accepted on mainnet." */
  name: string
  /** Standalone label, for headers and badges: "Stellar mainnet". */
  label: string
}

/**
 * Networks this app is deployed to. Anything else — a local quickstart node,
 * the SDK's SANDBOX and STANDALONE passphrases — is a working configuration,
 * so it describes itself as custom rather than throwing.
 */
const KNOWN_NETWORKS = new Map<string, StellarNetwork>([
  [
    Networks.PUBLIC,
    { id: 'mainnet', name: 'mainnet', label: 'Stellar mainnet' },
  ],
  [
    Networks.TESTNET,
    { id: 'testnet', name: 'testnet', label: 'Stellar testnet' },
  ],
  [
    Networks.FUTURENET,
    { id: 'futurenet', name: 'futurenet', label: 'Stellar futurenet' },
  ],
])

const CUSTOM_NETWORK: StellarNetwork = {
  id: 'custom',
  name: 'this network',
  label: 'a custom Stellar network',
}

/** Resolves a network passphrase to the vocabulary the UI shows. */
export function describeNetwork(passphrase: string): StellarNetwork {
  return KNOWN_NETWORKS.get(passphrase.trim()) ?? CUSTOM_NETWORK
}
