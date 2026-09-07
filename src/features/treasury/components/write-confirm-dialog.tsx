"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WriteOperation } from "@/lib/treasuryWrites";
import type { WriteWarning } from "@/lib/writeWarnings";

export type StagedWrite = {
  operation: WriteOperation;
  warnings: WriteWarning[];
};

/** Strkey addresses as they appear inside a `WriteOperation.summary`:
 * `G...` accounts and `C...` contracts, 56 chars of base32. */
const STRKEY_PATTERN = /\b[GC][A-Z2-7]{55}\b/g;

/**
 * Renders an operation summary with any address in it set as code.
 *
 * The address is never truncated here: substituting the address is the exact
 * thing this confirmation exists to let an operator catch, so the full string
 * has to be readable. `<code>` gets `overflow-wrap: anywhere` from globals.css,
 * which keeps a 56-character strkey from breaking the dialog's layout without
 * hiding any of it.
 */
function summaryWithAddresses(summary: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of summary.matchAll(STRKEY_PATTERN)) {
    const start = match.index;
    if (start > cursor) parts.push(summary.slice(cursor, start));
    parts.push(
      <code className="text-xs" key={`${start}-${match[0]}`}>
        {match[0]}
      </code>,
    );
    cursor = start + match[0].length;
  }

  if (cursor < summary.length) parts.push(summary.slice(cursor));
  return parts;
}

/**
 * The confirm step every write in this dApp passes through: summary, the
 * consequences `collectWriteWarnings` found, then sign.
 *
 * Shared by the Signers and Policy sections so the two cannot drift in what
 * they show an operator before a signature.
 */
export function WriteConfirmDialog({
  description,
  onCancel,
  onSubmit,
  pending,
  submitting,
}: {
  /** How this write is authorized -- differs per section (SmartAccount
   * authorization entry vs. plain transaction source). */
  description: ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  pending: StagedWrite | null;
  submitting: boolean;
}) {
  // Which staged write the operator has acknowledged the blocks on, held by
  // object identity rather than a boolean or an operation id. Staging always
  // builds a fresh object, so this resets itself on the next write and on a
  // retry of the same one, while staying ticked across the re-renders that
  // happen while the wallet prompt is up -- no effect, and nothing to clear.
  const [acknowledgedWrite, setAcknowledgedWrite] = useState<StagedWrite | null>(null);

  const blocks = pending?.warnings.filter((warning) => warning.severity === "block") ?? [];
  const acknowledged = pending !== null && acknowledgedWrite === pending;

  return (
    <Dialog onOpenChange={(open) => !open && onCancel()} open={pending !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm this change</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-relaxed">
          {pending ? summaryWithAddresses(pending.operation.summary) : null}
        </p>

        {pending && pending.warnings.length > 0 ? (
          <ul className="grid gap-2">
            {pending.warnings.map((warning) => (
              <li
                className={
                  warning.severity === "block"
                    ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs font-medium leading-relaxed text-destructive"
                    : "rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-warning"
                }
                key={warning.message}
              >
                {warning.message}
              </li>
            ))}
          </ul>
        ) : null}

        {pending && blocks.length > 0 ? (
          // The escape hatch that keeps a "block" from being a dead end. Every
          // block this dApp raises describes a rule it cannot satisfy on its
          // own, not a rule nobody can satisfy: the signatures can be collected
          // outside the dApp, and the operator may know something the read path
          // cannot see (signerAddresses misses non-`G` signers). So the block
          // costs a deliberate second action rather than forbidding the write.
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              checked={acknowledged}
              className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--destructive))]"
              onChange={(event) => setAcknowledgedWrite(event.target.checked ? pending : null)}
              type="checkbox"
            />
            <span>
              I understand{blocks.length === 1 ? " this consequence" : " these consequences"} and
              want to submit anyway.
            </span>
          </label>
        ) : null}

        <DialogFooter>
          <Button onClick={onCancel} variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={!pending || submitting || (blocks.length > 0 && !acknowledged)}
            onClick={onSubmit}
          >
            {submitting ? "Awaiting wallet…" : "Sign and submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
