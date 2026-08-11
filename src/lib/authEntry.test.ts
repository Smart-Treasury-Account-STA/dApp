import { describe, expect, it } from "vitest";
import { Address, Keypair, hash, xdr } from "@stellar/stellar-sdk";

import { signDelegatedAuthEntry } from "./stellarClient";
import type { WalletSigning } from "@/types";

const CONTRACT = "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS";

/**
 * Behaves like Freighter: it parses whatever it is handed strictly as a
 * `HashIdPreimage`, signs `hash(preimage.toXDR())`, and returns the raw
 * signature in base64 — not an authorization entry.
 *
 * Handing it a `SorobanAuthorizationEntry` makes the parse throw, which is the
 * production failure ("Invalid Authorization Entry — the authorization entry
 * XDR could not be parsed") reproduced here without a browser.
 */
function freighterLikeWallet(keypair: Keypair): WalletSigning {
  return {
    address: keypair.publicKey(),
    async signAuthEntry(authEntryXdr: string) {
      const preimage = xdr.HashIdPreimage.fromXDR(authEntryXdr, "base64");
      return keypair.sign(hash(preimage.toXDR())).toString("base64");
    },
    async signTransaction() {
      throw new Error("signTransaction is not part of this path.");
    },
  };
}

function unsignedDelegatedEntry(signerAddress: string, expirationLedger: number) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACT).toScAddress(),
        functionName: "__check_auth",
        args: [xdr.ScVal.scvU32(1)],
      }),
    ),
    subInvocations: [],
  });

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(signerAddress).toScAddress(),
        nonce: xdr.Int64.fromString("12345"),
        signatureExpirationLedger: expirationLedger,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
    rootInvocation: invocation,
  });
}

describe("signDelegatedAuthEntry", () => {
  const keypair = Keypair.random();
  const expirationLedger = 5_000_000;

  it("hands the wallet a preimage it can parse", async () => {
    const entry = unsignedDelegatedEntry(keypair.publicKey(), expirationLedger);

    await expect(
      signDelegatedAuthEntry(entry, freighterLikeWallet(keypair), expirationLedger),
    ).resolves.toBeDefined();
  });

  it("returns an entry carrying a real signature", async () => {
    const entry = unsignedDelegatedEntry(keypair.publicKey(), expirationLedger);

    const signed = await signDelegatedAuthEntry(
      entry,
      freighterLikeWallet(keypair),
      expirationLedger,
    );

    const credentials = signed.credentials().address();
    expect(credentials.signatureExpirationLedger()).toBe(expirationLedger);
    // An unsigned entry carries an empty vec; a signed one must not.
    expect(credentials.signature().vec()?.length ?? 0).toBeGreaterThan(0);
  });

  it("preserves the invocation the signer approved", async () => {
    const entry = unsignedDelegatedEntry(keypair.publicKey(), expirationLedger);

    const signed = await signDelegatedAuthEntry(
      entry,
      freighterLikeWallet(keypair),
      expirationLedger,
    );

    expect(signed.rootInvocation().toXDR("base64")).toBe(
      entry.rootInvocation().toXDR("base64"),
    );
  });

  it("fails loudly when the wallet returns nothing", async () => {
    const entry = unsignedDelegatedEntry(keypair.publicKey(), expirationLedger);
    const silentWallet: WalletSigning = {
      address: keypair.publicKey(),
      async signAuthEntry() {
        return undefined;
      },
      async signTransaction() {
        return undefined;
      },
    };

    await expect(
      signDelegatedAuthEntry(entry, silentWallet, expirationLedger),
    ).rejects.toThrow(/did not return a signed authorization entry/i);
  });
});
