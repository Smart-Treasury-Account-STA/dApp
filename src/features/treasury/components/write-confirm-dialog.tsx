"use client";

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
  const blocked = pending?.warnings.some((warning) => warning.severity === "block") ?? false;

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

        <DialogFooter>
          <Button onClick={onCancel} variant="secondary">
            Cancel
          </Button>
          <Button disabled={!pending || submitting || blocked} onClick={onSubmit}>
            {submitting ? "Awaiting wallet…" : "Sign and submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
