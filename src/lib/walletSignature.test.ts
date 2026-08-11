import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

import { decodeWalletSignature } from "./walletSignature";

const keypair = Keypair.random();
const signature = keypair.sign(Buffer.from("payload"));
const correctlyEncoded = signature.toString("base64");

/**
 * Reproduces what `@creit.tech/stellar-wallets-kit` returns for Freighter:
 * `Buffer.from(signedAuthEntry).toString("base64")`. That assumes
 * `freighter-api` hands it a Buffer, but Freighter 5.x resolves with a
 * base64 *string*, so this re-encodes the characters of a base64 string and
 * adds a second layer.
 */
const doubleEncoded = Buffer.from(correctlyEncoded).toString("base64");

describe("decodeWalletSignature", () => {
  it("decodes a correctly encoded signature to its 64 raw bytes", () => {
    expect(decodeWalletSignature(correctlyEncoded)).toEqual(signature);
  });

  it("unwraps the extra base64 layer the wallets kit adds to Freighter's reply", () => {
    // Without this, the wallet's signature reaches authorizeEntry as 88 bytes
    // of base64 text, verify() rejects it, and the only symptom is the SDK's
    // "signature doesn't match payload" — which points nowhere near encoding.
    expect(decodeWalletSignature(doubleEncoded)).toEqual(signature);
  });

  it("keeps the signature verifiable against the key that produced it", () => {
    const decoded = decodeWalletSignature(doubleEncoded);

    expect(keypair.verify(Buffer.from("payload"), decoded)).toBe(true);
  });

  it("reports the actual size when the value is neither shape", () => {
    const garbage = Buffer.alloc(10).toString("base64");

    expect(() => decodeWalletSignature(garbage)).toThrow(/10 bytes.*64-byte/i);
  });
});
