"use client";

import { LogOut, Plus, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { STELLAR_CONFIG } from "@/config";
import { deployAccount } from "@/lib/deployAccount";
import { truncateAddress } from "@/lib/format";
import { walletSigner } from "@/lib/writeAuth";
import { useMyTreasuries } from "@/features/treasury/queries";
import { registerTreasury } from "@/features/treasury/treasuryRegistryClient";
import type { CreateTreasuryInput } from "@/lib/treasuryRegistry/types";
import { useWallet } from "@/providers/wallet-provider";

const DEPLOY_NOT_CONFIGURED =
  !STELLAR_CONFIG.accountFactoryId || !STELLAR_CONFIG.relayerExecutorAddress;

/**
 * Registration is a second, separate step after a real on-chain deploy --
 * if it fails (network hiccup, or a rejected TreasuryConflictError), the
 * treasury still genuinely exists on-chain; only the dApp's own registry
 * entry is missing. Distinguishing this from a deploy failure matters
 * because the fix is "retry registering this address," not "redeploy" --
 * redeploying would spend another six wallet signatures and testnet fees
 * to create a second, different treasury the user didn't need.
 */
class RegistrationFailedAfterDeployError extends Error {
  constructor(
    public readonly input: CreateTreasuryInput,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export default function TreasuriesPage() {
  const router = useRouter();
  const { wallet, connect, disconnect } = useWallet();
  const treasuriesQuery = useMyTreasuries(wallet.address);

  const registerMutation = useMutation({
    mutationFn: (input: CreateTreasuryInput) => registerTreasury(input),
    onSuccess: (treasury) => {
      toast.success("Treasury registered", {
        description: `${truncateAddress(treasury.smartAccountId)} is ready to configure.`,
      });
      router.push(`/treasuries/${treasury.smartAccountId}`);
    },
    onError: (error, input) => {
      toast.error("Registration failed", {
        description: error instanceof Error ? error.message : String(error),
        action: {
          label: "Retry",
          onClick: () => registerMutation.mutate(input),
        },
      });
    },
  });

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Connect a wallet first.");
      const { receipt, deployed } = await deployAccount(walletSigner(wallet.address));
      const input: CreateTreasuryInput = {
        ...deployed,
        ownerAddress: wallet.address,
        executorAddress: STELLAR_CONFIG.relayerExecutorAddress as string,
        deployTxHash: receipt.hash,
      };
      try {
        return await registerTreasury(input);
      } catch (error) {
        throw new RegistrationFailedAfterDeployError(input, error);
      }
    },
    onMutate: () => {
      toast.info("Deploying treasury", {
        description:
          "Approve six authorization prompts in your wallet — one per contract this deploys and wires together.",
      });
    },
    onSuccess: (treasury) => {
      toast.success("Treasury deployed", {
        description: `${truncateAddress(treasury.smartAccountId)} is ready to configure.`,
      });
      router.push(`/treasuries/${treasury.smartAccountId}`);
    },
    onError: (error) => {
      if (error instanceof RegistrationFailedAfterDeployError) {
        toast.error("Deployed, but registration failed", {
          description: `${truncateAddress(error.input.smartAccountId)} exists on-chain — retry registering it rather than deploying again.`,
          action: {
            label: "Retry registration",
            onClick: () => registerMutation.mutate(error.input),
          },
        });
        return;
      }
      toast.error("Deployment failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <main className="mx-auto grid min-h-screen max-w-4xl content-start gap-6 p-8 max-sm:p-4">
      <header className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-primary" size={26} />
          <div>
            <span className="block text-xs font-bold uppercase text-muted-foreground">
              Smart Treasury Account
            </span>
            <h1 className="text-2xl font-semibold">My Treasuries</h1>
          </div>
        </div>
        {wallet.connected ? (
          <div className="flex items-center gap-2">
            <code className="text-xs text-muted-foreground">
              {truncateAddress(wallet.address)}
            </code>
            <Button onClick={disconnect} variant="secondary">
              <LogOut size={16} />
              Disconnect
            </Button>
          </div>
        ) : (
          <Button onClick={() => connect().catch((error) => toast.error("Connection failed", {
            description: error instanceof Error ? error.message : String(error),
          }))}>
            <WalletIcon size={16} />
            Connect wallet
          </Button>
        )}
      </header>

      {!wallet.connected ? (
        <div className="grid min-h-40 place-items-center rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          Connect a wallet to see the treasuries it owns, or deploy a new one.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Deployed treasuries</h2>
            <Button
              disabled={DEPLOY_NOT_CONFIGURED || deployMutation.isPending}
              onClick={() => deployMutation.mutate()}
            >
              <Plus size={16} />
              {deployMutation.isPending ? "Deploying…" : "Deploy new treasury"}
            </Button>
          </div>

          {DEPLOY_NOT_CONFIGURED ? (
            <p className="text-xs text-muted-foreground">
              Deployment is not configured on this environment (NEXT_PUBLIC_ACCOUNT_FACTORY_ID /
              NEXT_PUBLIC_RELAYER_EXECUTOR_ADDRESS are unset).
            </p>
          ) : null}

          {treasuriesQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : treasuriesQuery.data?.length ? (
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {treasuriesQuery.data.map((treasury) => (
                <Link
                  className="grid gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-secondary"
                  href={`/treasuries/${treasury.smartAccountId}`}
                  key={treasury.smartAccountId}
                >
                  <strong className="text-sm">{truncateAddress(treasury.smartAccountId, 9, 7)}</strong>
                  <span className="text-xs text-muted-foreground">
                    Deployed {new Date(treasury.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              No treasuries deployed with this wallet yet.
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Or use the{" "}
            <Link className="underline" href="/">
              default testnet treasury
            </Link>{" "}
            without deploying your own.
          </p>
        </>
      )}
    </main>
  );
}
