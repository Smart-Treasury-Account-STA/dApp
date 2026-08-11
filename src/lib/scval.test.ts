import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

import { structScVal } from "./scval";

function keysOf(value: xdr.ScVal): string[] {
  return (value.map() ?? []).map((entry) => entry.key().sym().toString());
}

describe("structScVal", () => {
  it("sorts map keys, because Soroban rejects an unsorted ScMap", () => {
    const value = structScVal({
      operation: xdr.ScVal.scvSymbol("transfer"),
      asset: xdr.ScVal.scvU32(1),
      destination: xdr.ScVal.scvU32(2),
      amount: xdr.ScVal.scvU32(3),
      expected_version: xdr.ScVal.scvU32(4),
    });

    expect(keysOf(value)).toEqual([
      "amount",
      "asset",
      "destination",
      "expected_version",
      "operation",
    ]);
  });

  it("keeps each key bound to its own value while reordering", () => {
    const value = structScVal({
      operation: xdr.ScVal.scvU32(10),
      amount: xdr.ScVal.scvU32(20),
    });

    const entries = (value.map() ?? []).map(
      (entry: xdr.ScMapEntry) =>
        [entry.key().sym().toString(), entry.val().u32()] as const,
    );

    expect(entries).toEqual([
      ["amount", 20],
      ["operation", 10],
    ]);
  });

  it("sorts underscore-bearing field names by byte order", () => {
    const value = structScVal({
      start_ledger: xdr.ScVal.scvU32(1),
      execution_count: xdr.ScVal.scvU32(2),
      end_ledger: xdr.ScVal.scvU32(3),
      intent_id: xdr.ScVal.scvU32(4),
      max_executions: xdr.ScVal.scvU32(5),
    });

    expect(keysOf(value)).toEqual([
      "end_ledger",
      "execution_count",
      "intent_id",
      "max_executions",
      "start_ledger",
    ]);
  });

  it("returns an empty map for a struct with no fields", () => {
    expect(keysOf(structScVal({}))).toEqual([]);
  });
});
