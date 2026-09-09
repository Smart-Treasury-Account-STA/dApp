import { STELLAR_CONFIG } from '@/config'
import type { WalletState } from '@/types'

type WalletOption = {
  id: string
  name?: string
}

type WalletAddressResult =
  | string
  | {
      address?: string
      publicKey?: string
    }

type WalletKit = {
  openModal?: (input: {
    onWalletSelected: (option: WalletOption) => Promise<void> | void
  }) => void
  setWallet?: (walletId: string) => void
  /** `skipRequestAccess` suppresses the kit's `requestAccess()` call, and with
   * it Freighter's approval popup -- required for any read that is not a
   * deliberate user action (see getConnectedAddress). */
  getAddress: (params?: {
    skipRequestAccess?: boolean
  }) => Promise<WalletAddressResult>
  signAuthEntry?: (
    preimageXdr: string,
    options: { address: string; networkPassphrase: string }
  ) => Promise<string | { signedAuthEntry?: string; signerAddress?: string }>
  signTransaction?: (
    transactionXdr: string,
    options: { address: string; networkPassphrase: string }
  ) => Promise<
    | string
    | {
        signedTxXdr?: string
        signedTransaction?: string
        signerAddress?: string
      }
  >
}

type WalletKitModule = {
  StellarWalletsKit: new (input: {
    network: string
    selectedWalletId: string
    modules: unknown[]
  }) => WalletKit
  FREIGHTER_ID?: string
  WalletType?: { freighter?: string }
  allowAllModules?: () => unknown[]
}

type WalletKitHandle = {
  kit: WalletKit
  selectedWalletId?: string
}

let kitHandle: WalletKitHandle | null = null

type ModalCapableKit = Pick<WalletKit, 'openModal' | 'setWallet'>

/**
 * Opens the Wallets Kit selection modal and resolves with the wallet the user
 * picked, or `undefined` when the kit exposes no modal.
 */
export async function selectWalletThroughModal(
  kit: ModalCapableKit
): Promise<string | undefined> {
  const { openModal } = kit
  if (typeof openModal !== 'function') {
    return undefined
  }

  return new Promise<string>((resolve) => {
    // Invoked with `kit` as the receiver. The kit reads `this` (for
    // `this.modalElement`), and ES modules are strict mode, so calling the
    // detached reference would leave `this` undefined and throw before the
    // modal ever renders.
    openModal.call(kit, {
      onWalletSelected: async (option: { id: string; name?: string }) => {
        if (typeof kit.setWallet === 'function') {
          kit.setWallet(option.id)
        }
        resolve(option.id)
      },
    })
  })
}

/**
 * Opens the wallet selection modal and returns the connected wallet.
 *
 * The kit is constructed for the configured network, the same passphrase
 * `signTransaction` and `signAuthEntry` pass on every call. The kit's own
 * `WalletNetwork` enum values are the passphrases themselves, so the
 * configured value goes straight through. This used to be pinned to
 * `WalletNetwork.TESTNET`, which left the kit advertising testnet to wallet
 * modules while the app built and signed mainnet transactions.
 */
export async function connectWallet(): Promise<WalletState> {
  const kitModule =
    (await import('@creit.tech/stellar-wallets-kit')) as unknown as WalletKitModule
  const modules =
    typeof kitModule.allowAllModules === 'function'
      ? kitModule.allowAllModules()
      : []
  const selectedWalletId =
    kitModule.FREIGHTER_ID ?? kitModule.WalletType?.freighter ?? 'freighter'

  const kit = new kitModule.StellarWalletsKit({
    network: STELLAR_CONFIG.networkPassphrase,
    selectedWalletId,
    modules,
  })

  kitHandle = { kit, selectedWalletId }

  const pickedWalletId = await selectWalletThroughModal(kit)
  if (pickedWalletId) {
    kitHandle = { kit, selectedWalletId: pickedWalletId }
  }

  const addressResult = await kit.getAddress()
  const address =
    typeof addressResult === 'string'
      ? addressResult
      : (addressResult.address ?? addressResult.publicKey ?? null)

  return {
    address,
    walletName: kitHandle.selectedWalletId ?? 'Stellar wallet',
    connected: Boolean(address),
  }
}

/**
 * Drops the connected kit so the next connect starts from the wallet chooser
 * again. Used when the operator needs to switch accounts — a treasury write is
 * only valid from the registered signer, so switching is a routine action here.
 */
export function disconnectWallet() {
  kitHandle = null
}

/**
 * Re-reads the currently connected kit's address, or `null` if nothing is
 * connected. Neither Freighter nor this kit emits an event when the
 * extension's selected account changes — switching accounts in Freighter
 * itself leaves this dApp's cached `wallet.address` stale until something
 * calls `getAddress()` again. `WalletProvider` polls this to catch that
 * without requiring a manual disconnect/reconnect. Swallows errors (a
 * locked or disconnected extension) rather than throwing, since a poll
 * failing once is not the caller's problem.
 *
 * `skipRequestAccess: true` is what makes polling safe, and is not optional
 * here. The kit's FreighterModule.getAddress calls `requestAccess()` first
 * unless told not to (verified in
 * `@creit.tech/stellar-wallets-kit@1.9.5/modules/freighter.module.mjs`), and
 * `requestAccess()` opens the extension's approval popup whenever the
 * currently selected account has not yet granted this origin -- which is
 * exactly the situation right after someone switches accounts in Freighter,
 * the one case this poll exists to detect. Without this flag the poll opened
 * a new popup every tick, stacking windows faster than they could be
 * dismissed. Read-only address reads must never prompt.
 */
export async function getConnectedAddress(): Promise<string | null> {
  if (!kitHandle?.kit) return null
  try {
    const addressResult = await kitHandle.kit.getAddress({
      skipRequestAccess: true,
    })
    return typeof addressResult === 'string'
      ? addressResult
      : (addressResult.address ?? addressResult.publicKey ?? null)
  } catch {
    return null
  }
}

export async function signAuthEntry(preimageXdr: string, address: string) {
  if (!kitHandle?.kit) {
    throw new Error('No wallet is connected.')
  }
  if (typeof kitHandle.kit.signAuthEntry !== 'function') {
    throw new Error('Connected wallet does not expose signAuthEntry.')
  }

  const result = await kitHandle.kit.signAuthEntry(preimageXdr, {
    address,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
  if (typeof result === 'string') {
    return { signature: result }
  }
  if (!result.signedAuthEntry) {
    return undefined
  }
  return {
    signature: result.signedAuthEntry,
    signerAddress: result.signerAddress,
  }
}

export async function signTransaction(transactionXdr: string, address: string) {
  if (!kitHandle?.kit) {
    throw new Error('No wallet is connected.')
  }
  if (typeof kitHandle.kit.signTransaction !== 'function') {
    throw new Error('Connected wallet does not expose signTransaction.')
  }

  const result = await kitHandle.kit.signTransaction(transactionXdr, {
    address,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
  if (typeof result === 'string') {
    return { xdr: result }
  }
  const xdr = result.signedTxXdr ?? result.signedTransaction
  if (!xdr) return undefined
  // signerAddress is the account the wallet actually signed with -- see
  // signEnvelope in stellarClient.ts for why the caller must check this
  // instead of trusting the requested `address` was honored.
  return { xdr, signerAddress: result.signerAddress }
}
