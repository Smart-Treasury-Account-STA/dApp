import { describe, expect, it } from "vitest";

import { collectWriteWarnings } from "./writeWarnings";
import type { WriteWarning } from "./writeWarnings";
import {
  addContextRuleOperation,
  addSignerOperation,
  bumpVersionOperation,
  removeContextRuleOperation,
  setAssetRuleOperation,
  setOperationAllowedOperation,
  setRecipientAllowedOperation,
} from "./treasuryWrites";
import type { ContextRule } from "@/types";

const ASSET = "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L";
const OWNER = "GCWFJKLE45TMVZS42TMIYKAORKGBWE74753YPOSCC5ESJR2G2UMBXBDB";
const OTHER = "GAK3XILRBYBMBOCZMSLL2CLR6WPQLEIOC6ZCYYPTE4OIAX3PCFFO2YMU";

const context = {
  currentVersion: 1,
  pinnedVersions: [] as number[],
  connectedAddress: OWNER,
  ownerAddress: OWNER,
};

describe("collectWriteWarnings — bump_version against the relayer queue", () => {
  it("counts queued intents that the bump would strand", () => {
    const warnings = collectWriteWarnings(bumpVersionOperation({ nextVersion: 2 }), {
      ...context,
      pinnedVersions: [1, 1, 2],
    });

    expect(warnings).toContainEqual({
      severity: "warn",
      message:
        "2 queued relayer intents are pinned to a version below 2 and will start failing with #2006.",
    });
  });

  it("stays quiet when nothing is stranded", () => {
    const warnings = collectWriteWarnings(bumpVersionOperation({ nextVersion: 2 }), {
      ...context,
      pinnedVersions: [2, 3],
    });

    expect(warnings.filter((w: WriteWarning) => w.message.includes("#2006"))).toEqual([]);
  });
});

describe("collectWriteWarnings — destructive policy changes", () => {
  it("warns that disabling transfer stops every payment", () => {
    const warnings = collectWriteWarnings(
      setOperationAllowedOperation({ operation: "transfer", allowed: false }),
      context,
    );

    expect(warnings.some((w: WriteWarning) => /stop every payment/i.test(w.message))).toBe(true);
  });

  it("does not warn when enabling an operation", () => {
    const warnings = collectWriteWarnings(
      setOperationAllowedOperation({ operation: "transfer", allowed: true }),
      context,
    );

    expect(warnings).toEqual([]);
  });

  it("warns when an asset is being disabled", () => {
    const warnings = collectWriteWarnings(
      setAssetRuleOperation({ asset: ASSET, enabled: false, maxSingleTransfer: "0" }),
      context,
    );

    expect(warnings.some((w: WriteWarning) => /disable/i.test(w.message))).toBe(true);
  });
});

describe("collectWriteWarnings — authority mismatch", () => {
  it("warns when the connected key is not the treasury owner (source-account op)", () => {
    // setRecipientAllowedOperation is a policy_engine, source-account write --
    // covers the "still fires for source-account operations" case too.
    const warnings = collectWriteWarnings(
      setRecipientAllowedOperation({ recipient: OTHER, allowed: true }),
      { ...context, connectedAddress: OTHER },
    );

    expect(warnings.some((w: WriteWarning) => /not the treasury owner/i.test(w.message))).toBe(true);
  });

  it("says nothing about authority when the owner is connected", () => {
    const warnings = collectWriteWarnings(
      setRecipientAllowedOperation({ recipient: OTHER, allowed: true }),
      context,
    );

    expect(warnings.some((w: WriteWarning) => /not the treasury owner/i.test(w.message))).toBe(false);
  });

  it("stays silent for custom-account operations even when the connected key is not the owner", () => {
    // add_signer is a smart_account, custom-account write -- satisfiable by
    // any valid context-rule signer, not just the owner, so a mismatch here
    // is not itself a problem.
    const warnings = collectWriteWarnings(
      addSignerOperation({ contextRuleId: 0, signerAddress: OTHER }),
      { ...context, connectedAddress: OTHER },
    );

    expect(warnings.some((w: WriteWarning) => /not the treasury owner/i.test(w.message))).toBe(false);
  });
});

function rule(overrides: Partial<ContextRule> & { id: number }): ContextRule {
  return {
    name: `rule-${overrides.id}`,
    contextType: "Default",
    signerCount: 1,
    signerAddresses: ["GEXISTING"],
    policyCount: 0,
    ...overrides,
  };
}

describe("collectWriteWarnings — unanimous-signer trap", () => {
  it("warns adding a signer to a no-policy rule that already has one", () => {
    const targetRule = rule({ id: 0, signerCount: 1, signerAddresses: ["GEXISTING"] });
    const warnings = collectWriteWarnings(addSignerOperation({ contextRuleId: 0, signerAddress: OTHER }), {
      ...context,
      targetRule,
    });

    // No threshold-policy contract exists anywhere in this system, so this
    // is deliberately "warn", not "block" -- a permanent block would leave
    // adding a second signer forever un-confirmable with no escape hatch.
    expect(warnings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        message: expect.stringMatching(/every signer.*co-sign/i),
      }),
    );
  });

  it("stays quiet adding the first signer to a genuinely empty rule", () => {
    const targetRule = rule({ id: 0, signerCount: 0, signerAddresses: [] });
    const warnings = collectWriteWarnings(addSignerOperation({ contextRuleId: 0, signerAddress: OTHER }), {
      ...context,
      targetRule,
    });

    expect(warnings.some((w) => /co-sign/i.test(w.message))).toBe(false);
  });

  it("stays quiet adding a signer to a policy-gated rule -- the policy decides the real threshold", () => {
    const targetRule = rule({ id: 0, signerCount: 1, signerAddresses: ["GEXISTING"], policyCount: 1 });
    const warnings = collectWriteWarnings(addSignerOperation({ contextRuleId: 0, signerAddress: OTHER }), {
      ...context,
      targetRule,
    });

    expect(warnings.some((w) => /co-sign/i.test(w.message))).toBe(false);
  });

  it("does not fail open when signerAddresses is empty but signerCount says the rule already has a signer", () => {
    // signerAddresses is a best-effort regex scrape that misses non-`G`
    // signers (e.g. Signer::Delegated(C...)); signerCount is the
    // contract-enforced source of truth. The trap must fire on signerCount
    // even when the address list came back empty.
    const targetRule = rule({ id: 0, signerCount: 1, signerAddresses: [] });
    const warnings = collectWriteWarnings(addSignerOperation({ contextRuleId: 0, signerAddress: OTHER }), {
      ...context,
      targetRule,
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        message: expect.stringMatching(/every signer.*co-sign/i),
      }),
    );
  });
});

describe("collectWriteWarnings — creating a new context rule", () => {
  it("warns that the treasury becomes only as secure as the new rule", () => {
    const allRules = [rule({ id: 0, signerCount: 3, signerAddresses: ["A", "B", "C"] })];
    const warnings = collectWriteWarnings(
      addContextRuleOperation({ name: "new-rule", signerAddress: OTHER }),
      { ...context, allRules },
    );

    expect(warnings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        message: expect.stringMatching(/only as secure as this new rule/i),
      }),
    );
  });
});

describe("collectWriteWarnings — removing a context rule", () => {
  it("warns naming the rule and how many signers lose access", () => {
    const targetRule = rule({ id: 0, name: "payroll", signerCount: 2, signerAddresses: ["GEXISTING", "GOTHER"] });
    const warnings = collectWriteWarnings(removeContextRuleOperation({ contextRuleId: 0 }), {
      ...context,
      targetRule,
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        message: expect.stringMatching(/payroll/),
      }),
    );
    expect(warnings.some((w: WriteWarning) => /2 of its signers/i.test(w.message))).toBe(true);
  });

  it("adds a self-removal warning when the connected wallet is one of the rule's own signers", () => {
    const targetRule = rule({
      id: 0,
      name: "payroll",
      signerCount: 1,
      signerAddresses: [OWNER],
    });
    const warnings = collectWriteWarnings(removeContextRuleOperation({ contextRuleId: 0 }), {
      ...context,
      connectedAddress: OWNER,
      targetRule,
    });

    expect(
      warnings.some((w: WriteWarning) => /connected wallet.*(own signers|lose access)/i.test(w.message)),
    ).toBe(true);
  });

  it("does not add a self-removal warning when the connected wallet is not one of the rule's signers", () => {
    const targetRule = rule({
      id: 0,
      name: "payroll",
      signerCount: 1,
      signerAddresses: ["GEXISTING"],
    });
    const warnings = collectWriteWarnings(removeContextRuleOperation({ contextRuleId: 0 }), {
      ...context,
      connectedAddress: OWNER,
      targetRule,
    });

    expect(
      warnings.some((w: WriteWarning) => /lose access|own signers/i.test(w.message)),
    ).toBe(false);
  });
});
