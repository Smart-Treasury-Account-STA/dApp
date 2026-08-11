import { signAuthEntry, signTransaction } from "@/lib/wallet";
import { signAndSubmitContractInvocation, submitAsSourceAccount } from "@/lib/stellarClient";
import type { WriteOperation } from "@/lib/treasuryWrites";
import type { TransactionReceipt, WalletSigning } from "@/types";

export function walletSigner(address: string): WalletSigning {
  return { address, signAuthEntry, signTransaction };
}

/**
 * Runs a write descriptor under the authorization model its target contract
 * uses. `custom-account` calls go through the SmartAccount AuthPayload path,
 * which asks the wallet for `signAuthEntry`. `source-account` calls are plain
 * `Address::require_auth()` and ask for `signTransaction` instead.
 */
export async function executeWriteOperation(
  operation: WriteOperation,
  wallet: WalletSigning,
): Promise<TransactionReceipt> {
  if (operation.strategy === "custom-account") {
    return signAndSubmitContractInvocation({
      args: operation.args,
      functionName: operation.functionName,
      sourceAddress: wallet.address,
      wallet,
    });
  }

  return submitAsSourceAccount({
    args: operation.args,
    contractId: operation.contractId,
    functionName: operation.functionName,
    wallet,
  });
}
