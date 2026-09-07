import type { ContextRule } from "@/types";
import { computeWeakestRule, findAuthorizingPath } from "@/lib/treasurySecurity";
import type { WriteOperation } from "@/lib/treasuryWrites";

export type WriteWarning = { severity: "warn" | "block"; message: string };

export type WarningContext = {
  currentVersion: number;
  /** Policy versions pinned by the intents behind queued relayer jobs. */
  pinnedVersions: number[];
  connectedAddress: string | null;
  ownerAddress: string | null;
  /** The rule a signer-management write targets, when applicable. */
  targetRule?: ContextRule;
  /** Every rule the treasury currently has, for the weakest-rule check. */
  allRules?: ContextRule[];
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
    operation.strategy === "source-account" &&
    context.ownerAddress !== null &&
    context.connectedAddress !== null &&
    context.connectedAddress !== context.ownerAddress
  ) {
    warnings.push({
      severity: "warn",
      // "admin", not "signer": policy_engine and recovery_manager gate their
      // writes on a plain `Address::require_auth()` against their own admin
      // key, with no involvement from the SmartAccount's context rules -- so
      // being a signer on a rule grants nothing here. The owner is named as
      // the reference because under this project's Tier 1 deploy the owner,
      // policy admin and recovery admin are the same key; that is a property
      // of how these treasuries are deployed, not something the contracts
      // enforce, hence the hedge rather than a flat "you are not the admin".
      message: `This write is authorized by the target contract's own admin key, not by the SmartAccount's signers. The connected wallet is not the treasury owner${
        context.ownerAddress ? ` (${context.ownerAddress})` : ""
      }, which is also the policy and recovery admin on a treasury deployed this way. Simulation cannot check this: it will be rejected on-chain after you sign, and the fee is still charged.`,
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

  if (operation.functionName === "add_signer" && context.targetRule) {
    const { policyCount, signerCount } = context.targetRule;
    // signerCount is the contract-enforced count, unlike signerAddresses
    // (a best-effort regex scrape that can silently miss non-`G` signers,
    // e.g. Signer::Delegated(C...)) -- see treasurySecurity.ts. Using it
    // here means this check never fails open just because the display-only
    // address list came back empty.
    if (policyCount === 0 && signerCount >= 1) {
      warnings.push({
        // "block", not "warn": `smartAccountAuthPayload` signs exactly one
        // authorization entry per submission, so the rule this creates is
        // unusable from this dApp until a threshold policy is attached --
        // and no threshold-policy contract is deployed in this system yet.
        // The confirm dialog lets an operator acknowledge and proceed
        // anyway (the fix is reachable off-dApp, by co-signing with both
        // keys from a script), so the block informs rather than traps.
        severity: "block",
        message:
          "This rule has no threshold policy: adding this signer means every signer on the rule — including this new one — must co-sign every future action under it, including removals. Set a threshold first if you want N-of-M instead of all-of-N.",
      });
    }
  }

  if (operation.functionName === "remove_context_rule" && context.targetRule) {
    const { name, signerCount, signerAddresses } = context.targetRule;
    warnings.push({
      severity: "warn",
      message: `This removes rule "${name}" entirely, along with ${signerCount === 1 ? "its signer's" : `all ${signerCount} of its signers'`} access through it.`,
    });
    if (
      context.connectedAddress !== null &&
      signerAddresses.includes(context.connectedAddress)
    ) {
      warnings.push({
        severity: "warn",
        message:
          "The connected wallet is one of this rule's own signers — removing this rule revokes this wallet's access through it. If this is the only rule this wallet can satisfy, it will lose access to this treasury.",
      });
    }
  }

  if (operation.functionName === "add_context_rule" && context.allRules) {
    const { requiredSigners: existingWeakest } = computeWeakestRule(context.allRules)
      .weakestUnanimousRule ?? { requiredSigners: Infinity };
    warnings.push({
      severity: "warn",
      message:
        existingWeakest === 1
          ? "This treasury already has a rule satisfiable by a single signer — adding another independent rule cannot make it less secure, but the new rule's signer will have full, independent control equal to every other rule's signers."
          : "Creating a new, independent context rule means this treasury becomes only as secure as this new rule, regardless of how strong your other rules are — any one satisfied rule authorizes anything, including creating further rules. The new signer gets full, independent power, not a limited role.",
    });
  }

  // Whether the connected wallet can satisfy any rule on its own. Applies to
  // every smart_account write, not one function name: they are all authorized
  // the same way, and simulation cannot check authorization, so without this
  // the operator learns the answer from an on-chain rejection after signing.
  if (operation.strategy === "custom-account" && context.allRules) {
    const path = findAuthorizingPath(context.allRules, context.connectedAddress);

    if (path.rules.length > 0 && path.soleSignerRule === null) {
      const many = path.rules.length > 1;
      const ruleList = path.rules.map((rule) => `${rule.id} · ${rule.name}`).join(", ");

      warnings.push(
        path.blocked
          ? {
              severity: "block",
              message: `This wallet is only registered on ${many ? "rules" : "rule"} ${ruleList}, ${many ? "each of which requires" : "which requires"} every one of its signers to co-sign. This dApp submits one signature per transaction, so this write will be rejected on-chain (#3002) after you sign it. Collect the other signatures outside this dApp, or attach a threshold policy first.`,
            }
          : {
              severity: "warn",
              message: `No rule this wallet is on is satisfiable by one signature outright. ${many ? "Rules" : "Rule"} ${ruleList} ${many ? "defer to attached policies whose thresholds" : "defers to an attached policy whose threshold"} this dApp cannot read: if more than one signature is needed, this write will be rejected on-chain after you sign it.`,
            },
      );
    }
  }

  return warnings;
}
