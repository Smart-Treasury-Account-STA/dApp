import { StrKey } from '@stellar/stellar-sdk'

export type ContractSet = {
  smartAccount: string
  policyEngine: string
  intentRegistry: string
  recoveryManager: string
  transferAdapter: string
  splitAdapter: string
  defaultAsset: string
}

export type StellarConfig = {
  rpcUrl: string
  networkPassphrase: string
  explorerBaseUrl: string
  contracts: ContractSet
  testDestination: string
  /** account_factory's contract id -- lets a connected wallet deploy its own
   * treasury. Optional (not part of the hard-required set below) so an
   * environment that hasn't configured it yet doesn't fail the whole app;
   * the deploy UI feature-detects its absence instead. */
  accountFactoryId: string | null
  /** Public key of the relayer's executor identity -- passed as `executor`
   * when deploying a new treasury so the shared relayer can service it.
   * Optional for the same reason as `accountFactoryId`. */
  relayerExecutorAddress: string | null
}

export class ConfigError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid Stellar configuration:\n- ${issues.join('\n- ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

type Source = Record<string, string | undefined>

const CONTRACT_KEYS = {
  smartAccount: 'NEXT_PUBLIC_SMART_ACCOUNT_ID',
  policyEngine: 'NEXT_PUBLIC_POLICY_ENGINE_ID',
  intentRegistry: 'NEXT_PUBLIC_INTENT_REGISTRY_ID',
  recoveryManager: 'NEXT_PUBLIC_RECOVERY_MANAGER_ID',
  transferAdapter: 'NEXT_PUBLIC_TRANSFER_ADAPTER_ID',
  splitAdapter: 'NEXT_PUBLIC_SPLIT_ADAPTER_ID',
  defaultAsset: 'NEXT_PUBLIC_DEFAULT_ASSET_CONTRACT_ID',
} as const satisfies Record<keyof ContractSet, string>

export function readStellarConfig(source: Source): StellarConfig {
  const issues: string[] = []

  function required(key: string) {
    const value = source[key]?.trim()
    if (!value) {
      issues.push(`${key} is required.`)
      return ''
    }
    return value
  }

  function httpsUrl(key: string) {
    const value = required(key)
    if (
      value &&
      !value.startsWith('https://') &&
      !value.startsWith('http://localhost')
    ) {
      issues.push(`${key} must be an https URL.`)
    }
    return value
  }

  function contractId(key: string) {
    const value = required(key)
    if (value && !StrKey.isValidContract(value)) {
      issues.push(`${key} must be a Stellar contract id starting with C.`)
    }
    return value
  }

  // Unlike `required`/`contractId` above, these two only flag an issue when
  // present-but-malformed -- absence is fine and resolves to `null`, so an
  // environment that hasn't configured the deploy feature yet doesn't fail
  // config validation for the whole app (see the `StellarConfig` doc
  // comments on these two fields).
  function optionalContractId(key: string): string | null {
    const value = source[key]?.trim()
    if (!value) return null
    if (!StrKey.isValidContract(value)) {
      issues.push(`${key} must be a Stellar contract id starting with C.`)
    }
    return value
  }

  function optionalEd25519PublicKey(key: string): string | null {
    const value = source[key]?.trim()
    if (!value) return null
    if (!StrKey.isValidEd25519PublicKey(value)) {
      issues.push(`${key} must be a Stellar account id starting with G.`)
    }
    return value
  }

  const rpcUrl = httpsUrl('NEXT_PUBLIC_STELLAR_RPC_URL')
  const networkPassphrase = required('NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE')
  const explorerBaseUrl = httpsUrl('NEXT_PUBLIC_STELLAR_EXPLORER_URL')

  const contracts = Object.fromEntries(
    Object.entries(CONTRACT_KEYS).map(([field, key]) => [
      field,
      contractId(key),
    ])
  ) as ContractSet

  // The env key keeps its published name -- renaming it would break every
  // deployment's configured variable for a vocabulary change. The field this
  // reads into follows the rest of the code: one payment target is a
  // `destination`.
  const testDestination = required('NEXT_PUBLIC_TEST_RECIPIENT')
  if (testDestination && !StrKey.isValidEd25519PublicKey(testDestination)) {
    issues.push(
      'NEXT_PUBLIC_TEST_RECIPIENT must be a Stellar account id starting with G.'
    )
  }

  const accountFactoryId = optionalContractId('NEXT_PUBLIC_ACCOUNT_FACTORY_ID')
  const relayerExecutorAddress = optionalEd25519PublicKey(
    'NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS'
  )

  if (issues.length > 0) {
    throw new ConfigError(issues)
  }

  return {
    rpcUrl,
    networkPassphrase,
    explorerBaseUrl,
    contracts,
    testDestination,
    accountFactoryId,
    relayerExecutorAddress,
  }
}
