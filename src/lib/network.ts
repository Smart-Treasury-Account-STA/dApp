/**
 * Which Stellar network the app is pointed at, derived from the configured
 * network passphrase.
 *
 * The passphrase is the single source of truth on purpose: it is already
 * required and validated (`NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`), it is
 * what every transaction is actually signed against, and it is what the
 * wallet kit is handed. A separate "network name" variable could drift and
 * label a testnet deployment "mainnet"; this cannot.
 *
 * Deliberately has no dependency on `@/config` (and therefore no env
 * validation), matching `@/lib/constants`, so tests can exercise it directly.
 */

/** Canonical passphrases, as published by Stellar and used by the wallet kit. */
export const STELLAR_NETWORK_PASSPHRASES = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
} as const;

export type StellarNetworkId =
  keyof typeof STELLAR_NETWORK_PASSPHRASES | "custom";

export type StellarNetwork = {
  id: StellarNetworkId;
  /** Bare name, for mid-sentence use: "accepted on mainnet." */
  name: string;
  /** Standalone label, for headers and badges: "Stellar mainnet". */
  label: string;
};

const NETWORKS: Record<StellarNetworkId, StellarNetwork> = {
  mainnet: { id: "mainnet", name: "mainnet", label: "Stellar mainnet" },
  testnet: { id: "testnet", name: "testnet", label: "Stellar testnet" },
  futurenet: { id: "futurenet", name: "futurenet", label: "Stellar futurenet" },
  // Standalone and quickstart networks define their own passphrase. Both
  // strings still read correctly in the sentences above.
  custom: {
    id: "custom",
    name: "this network",
    label: "a custom Stellar network",
  },
};

/**
 * Resolves a network passphrase to the vocabulary the UI shows. An unknown
 * passphrase is a working configuration (a local quickstart node, say), so it
 * describes itself as custom rather than throwing.
 */
export function describeNetwork(passphrase: string): StellarNetwork {
  const trimmed = passphrase.trim();
  const match = (
    Object.entries(STELLAR_NETWORK_PASSPHRASES) as [
      keyof typeof STELLAR_NETWORK_PASSPHRASES,
      string,
    ][]
  ).find(([, value]) => value === trimmed);

  return match ? NETWORKS[match[0]] : NETWORKS.custom;
}
