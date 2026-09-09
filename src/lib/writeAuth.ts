import { STELLAR_CONFIG } from '@/config'
import type { ContractSet } from '@/lib/env'
import {
  signAndSubmitContractInvocation,
  submitAsSourceAccount,
} from '@/lib/stellarClient'
import type { WriteOperation } from '@/lib/treasuryWrites'
import { signAuthEntry, signTransaction } from '@/lib/wallet'
import type { TransactionReceipt, WalletSigning } from '@/types'

export function walletSigner(address: string): WalletSigning {
  return { address, signAuthEntry, signTransaction }
}

/**
 * Runs a write descriptor under the authorization model its target contract
 * uses. `custom-account` calls go through the SmartAccount AuthPayload path,
 * which asks the wallet for `signAuthEntry`. `source-account` calls are plain
 * `Address::require_auth()` and ask for `signTransaction` instead.
 *
 * `contracts` must match whichever treasury `operation.contractId` was built
 * against (the treasuryWrites.ts builders default to STELLAR_CONFIG.contracts
 * too) -- for a `custom-account` operation this is what Entry A's AuthPayload
 * gets pinned to, so a mismatch here would build the wrong treasury's
 * authorization for the right treasury's call.
 */
export async function executeWriteOperation(
  operation: WriteOperation,
  wallet: WalletSigning,
  contracts: ContractSet = STELLAR_CONFIG.contracts
): Promise<TransactionReceipt> {
  if (operation.strategy === 'custom-account') {
    return signAndSubmitContractInvocation({
      args: operation.args,
      functionName: operation.functionName,
      sourceAddress: wallet.address,
      wallet,
      contracts,
    })
  }

  return submitAsSourceAccount({
    args: operation.args,
    contractId: operation.contractId,
    functionName: operation.functionName,
    wallet,
  })
}
