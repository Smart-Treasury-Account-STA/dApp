import type { WriteOperation } from "@/lib/treasuryWrites";

export type WriteWarning = { severity: "warn" | "block"; message: string };

export type WarningContext = {
  currentVersion: number;
  /** Policy versions pinned by the intents behind queued relayer jobs. */
  pinnedVersions: number[];
  connectedAddress: string | null;
  ownerAddress: string | null;
};

/**
 * Surfaces what a write will break, for the confirmation step.
 *
 * These are consequences the contract will not warn about: it applies the
 * change and lets the fallout happen later, on some other call.
 */
export function collectWriteWarnings(
  operation: WriteOperation,
  context: WarningContext,
): WriteWarning[] {
  const warnings: WriteWarning[] = [];

  if (
    context.ownerAddress !== null &&
    context.connectedAddress !== null &&
    context.connectedAddress !== context.ownerAddress
  ) {
    warnings.push({
      severity: "warn",
      message:
        "The connected wallet is not the treasury owner. This write will be rejected at submission, not at simulation.",
    });
  }

  if (operation.functionName === "bump_version") {
    const nextVersion = Number(operation.id.split(":")[1]);
    const stranded = context.pinnedVersions.filter((version) => version < nextVersion).length;
    if (stranded > 0) {
      warnings.push({
        severity: "warn",
        message: `${stranded} queued relayer intents are pinned to a version below ${nextVersion} and will start failing with #2006.`,
      });
    }
  }

  if (operation.functionName === "set_operation_allowed" && /Disable/.test(operation.summary)) {
    warnings.push({
      severity: "warn",
      message:
        "Disabling this operation will stop every payment that uses it, including scheduled ones.",
    });
  }

  if (operation.functionName === "set_asset_rule" && /Disable/.test(operation.summary)) {
    warnings.push({
      severity: "warn",
      message: "Disable this asset and every transfer of it stops, including queued intents.",
    });
  }

  return warnings;
}
