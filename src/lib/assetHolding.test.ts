import { describe, expect, it } from "vitest";

import { describeAssetReadiness, totalRequested } from "./assetHolding";
import type { AssetHolding } from "./assetHolding";

function holding(overrides: Partial<AssetHolding> = {}): AssetHolding {
  return { balance: 1000n, authorized: true, missing: false, ...overrides };
}

describe("describeAssetReadiness", () => {
  it("is ready when authorized with enough balance", () => {
    expect(describeAssetReadiness(holding(), 500n)).toEqual({ ready: true });
  });

  it("reports a missing trustline first, before authorization or balance", () => {
    // The token raises #13 before it looks at anything else. Naming a later
    // blocker would send the operator to fix the wrong thing.
    const result = describeAssetReadiness(
      holding({ missing: true, authorized: false, balance: null }),
    );

    expect(result).toMatchObject({ ready: false, reason: "missing" });
    expect(result.ready === false && result.message).toMatch(/own wallet/i);
  });

  it("reports deauthorization before an empty balance", () => {
    // Exactly the testnet case: a factory-created treasury reads balance 0 and
    // authorized false. "Fund it" would be useless advice — it cannot receive.
    const result = describeAssetReadiness(holding({ authorized: false, balance: 0n }));

    expect(result).toMatchObject({ ready: false, reason: "deauthorized" });
    expect(result.ready === false && result.message).toMatch(/issuer/i);
  });

  it("reports an empty balance when authorization is fine", () => {
    expect(describeAssetReadiness(holding({ balance: 0n }))).toMatchObject({
      ready: false,
      reason: "empty",
    });
  });

  it("reports an insufficient balance only against a requested amount", () => {
    expect(describeAssetReadiness(holding({ balance: 100n }), 500n)).toMatchObject({
      ready: false,
      reason: "insufficient",
    });
    // Without an amount the question is "can this send anything at all".
    expect(describeAssetReadiness(holding({ balance: 100n }))).toEqual({ ready: true });
  });

  it("accepts an amount exactly equal to the balance", () => {
    expect(describeAssetReadiness(holding({ balance: 100n }), 100n)).toEqual({ ready: true });
  });

  it("treats an unknown authorization as acceptable rather than blocking", () => {
    // `null` means the read could not tell, not that it said no. Blocking on
    // an unknown would stop a payment that would have worked.
    expect(describeAssetReadiness(holding({ authorized: null }), 500n)).toEqual({ ready: true });
  });
});

describe("totalRequested", () => {
  it("sums valid amounts", () => {
    expect(totalRequested(["1000", "2500"])).toBe(3500n);
  });

  it("ignores entries that are not yet a whole number", () => {
    // A half-typed form must not read as a huge total and block the button
    // for a reason the operator cannot see.
    expect(totalRequested(["1000", "", "abc", "1.5", "-4"])).toBe(1000n);
  });

  it("is zero for an empty list", () => {
    expect(totalRequested([])).toBe(0n);
  });
});
