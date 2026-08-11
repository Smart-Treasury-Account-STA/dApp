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
  ) => Promise<string | { signedAuthEntry?: string }>;
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

  const openModal = kit.openModal;
  if (typeof openModal === "function") {
    await new Promise<void>((resolve) => {
      openModal({
        onWalletSelected: async (option: { id: string; name?: string }) => {
          if (typeof kit.setWallet === "function") {
            kit.setWallet(option.id);
          }
          kitHandle = { kit, selectedWalletId: option.id };
          resolve();
        },
      });
    });
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

export async function signAuthEntry(preimageXdr: string, address: string) {
  if (!kitHandle?.kit || typeof kitHandle.kit.signAuthEntry !== "function") {
    throw new Error("Connected wallet does not expose signAuthEntry.");
  }

  const result = await kitHandle.kit.signAuthEntry(preimageXdr, {
    address,
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  });
  return typeof result === "string" ? result : result.signedAuthEntry;
}

export async function signTransaction(transactionXdr: string, address: string) {
  if (!kitHandle?.kit || typeof kitHandle.kit.signTransaction !== "function") {
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
