import { describe, expect, it } from "vitest";

import { collectWriteWarnings } from "./writeWarnings";
import type { WriteWarning } from "./writeWarnings";
import {
  bumpVersionOperation,
  setAssetRuleOperation,
  setOperationAllowedOperation,
  setRecipientAllowedOperation,
} from "./treasuryWrites";

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
  it("warns when the connected key is not the treasury owner", () => {
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
});
