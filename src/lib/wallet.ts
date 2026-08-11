import { STELLAR_CONFIG } from "@/config";
import type { WalletState } from "@/types";

type WalletOption = {
  id: string;
  name?: string;
};

type WalletAddressResult =
  | string
  | {
      address?: string;
      publicKey?: string;
    };

type WalletKit = {
  openModal?: (input: {
    onWalletSelected: (option: WalletOption) => Promise<void> | void;
  }) => void;
  setWallet?: (walletId: string) => void;
  getAddress: () => Promise<WalletAddressResult>;
  signAuthEntry?: (
    preimageXdr: string,
    options: { address: string; networkPassphrase: string },
  ) => Promise<string | { signedAuthEntry?: string; signerAddress?: string }>;
  signTransaction?: (
    transactionXdr: string,
    options: { address: string; networkPassphrase: string },
  ) => Promise<string | { signedTxXdr?: string; signedTransaction?: string }>;
};

type WalletKitModule = {
  StellarWalletsKit: new (input: {
    network: string;
    selectedWalletId: string;
    modules: unknown[];
  }) => WalletKit;
  WalletNetwork?: { TESTNET?: string };
  FREIGHTER_ID?: string;
  WalletType?: { freighter?: string };
  allowAllModules?: () => unknown[];
};

type WalletKitHandle = {
  kit: WalletKit;
  selectedWalletId?: string;
};

let kitHandle: WalletKitHandle | null = null;

type ModalCapableKit = Pick<WalletKit, "openModal" | "setWallet">;

/**
 * Opens the Wallets Kit selection modal and resolves with the wallet the user
 * picked, or `undefined` when the kit exposes no modal.
 */
export async function selectWalletThroughModal(
  kit: ModalCapableKit,
): Promise<string | undefined> {
  const { openModal } = kit;
  if (typeof openModal !== "function") {
    return undefined;
  }

  return new Promise<string>((resolve) => {
    // Invoked with `kit` as the receiver. The kit reads `this` (for
    // `this.modalElement`), and ES modules are strict mode, so calling the
    // detached reference would leave `this` undefined and throw before the
    // modal ever renders.
    openModal.call(kit, {
      onWalletSelected: async (option: { id: string; name?: string }) => {
        if (typeof kit.setWallet === "function") {
          kit.setWallet(option.id);
        }
        resolve(option.id);
      },
    });
  });
}

export async function connectWallet(): Promise<WalletState> {
  const kitModule = (await import(
    "@creit.tech/stellar-wallets-kit"
  )) as unknown as WalletKitModule;
  const network = kitModule.WalletNetwork?.TESTNET ?? "TESTNET";
  const modules =
    typeof kitModule.allowAllModules === "function"
      ? kitModule.allowAllModules()
      : [];
  const selectedWalletId =
    kitModule.FREIGHTER_ID ?? kitModule.WalletType?.freighter ?? "freighter";

  const kit = new kitModule.StellarWalletsKit({
    network,
    selectedWalletId,
    modules,
  });

  kitHandle = { kit, selectedWalletId };

  const pickedWalletId = await selectWalletThroughModal(kit);
  if (pickedWalletId) {
    kitHandle = { kit, selectedWalletId: pickedWalletId };
  }

  const addressResult = await kit.getAddress();
  const address =
    typeof addressResult === "string"
      ? addressResult
      : (addressResult.address ?? addressResult.publicKey ?? null);

  return {
    address,
    walletName: kitHandle.selectedWalletId ?? "Stellar wallet",
    connected: Boolean(address),
  };
}

/**
 * Drops the connected kit so the next connect starts from the wallet chooser
 * again. Used when the operator needs to switch accounts — a treasury write is
 * only valid from the registered signer, so switching is a routine action here.
 */
export function disconnectWallet() {
  kitHandle = null;
}

export async function signAuthEntry(preimageXdr: string, address: string) {
  if (!kitHandle?.kit) {
    throw new Error("No wallet is connected.");
  }
  if (typeof kitHandle.kit.signAuthEntry !== "function") {
    throw new Error("Connected wallet does not expose signAuthEntry.");
  }

  const result = await kitHandle.kit.signAuthEntry(preimageXdr, {
    address,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  });
  if (typeof result === "string") {
    return { signature: result };
  }
  if (!result.signedAuthEntry) {
    return undefined;
  }
  return { signature: result.signedAuthEntry, signerAddress: result.signerAddress };
}

export async function signTransaction(transactionXdr: string, address: string) {
  if (!kitHandle?.kit) {
    throw new Error("No wallet is connected.");
  }
  if (typeof kitHandle.kit.signTransaction !== "function") {
    throw new Error("Connected wallet does not expose signTransaction.");
  }

  const result = await kitHandle.kit.signTransaction(transactionXdr, {
    address,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  });
  return typeof result === "string"
    ? result
    : (result.signedTxXdr ?? result.signedTransaction);
}
