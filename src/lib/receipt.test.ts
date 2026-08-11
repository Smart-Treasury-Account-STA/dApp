import { describe, expect, it } from "vitest";

import { describeReceipt } from "./receipt";

const LABELS = {
  confirmedTitle: "Scheduled payment created",
  submittedTitle: "Schedule submitted",
};

describe("describeReceipt", () => {
  it("reports a confirmed transaction as a success", () => {
    const result = describeReceipt({ hash: "abc", status: "SUCCESS" }, LABELS);

    expect(result.ok).toBe(true);
    expect(result.pending).toBeFalsy();
    expect(result.title).toBe("Scheduled payment created");
  });

  it("reports a failed transaction as a failure", () => {
    const result = describeReceipt({ hash: "abc", status: "FAILED" }, LABELS);

    expect(result.ok).toBe(false);
    expect(result.pending).toBeFalsy();
  });

  it("does not call a still-pending transaction a failure", () => {
    // Polling gives up after a bounded wait, but the network has not rejected
    // anything at that point. A schedule shown in red as "failed" was actually
    // confirmed on-chain two minutes later, and the operator had been told the
    // opposite.
    const result = describeReceipt({ hash: "abc", status: "PENDING" }, LABELS);

    expect(result.ok).toBe(true);
  });

  it("marks a still-pending transaction as pending, not confirmed", () => {
    const result = describeReceipt({ hash: "abc", status: "PENDING" }, LABELS);

    expect(result.pending).toBe(true);
    expect(result.title).toBe("Schedule submitted");
  });

  it("tells the operator the pending result is not final", () => {
    const result = describeReceipt({ hash: "abc", status: "PENDING" }, LABELS);

    expect(result.detail).toMatch(/still|may still confirm/i);
  });

  it("keeps the hash on every outcome so the transaction stays traceable", () => {
    for (const status of ["SUCCESS", "FAILED", "PENDING"]) {
      expect(describeReceipt({ hash: "abc", status }, LABELS).txHash).toBe("abc");
    }
  });
});
