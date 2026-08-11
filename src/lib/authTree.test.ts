import { describe, expect, it } from "vitest";
import { Address, xdr } from "@stellar/stellar-sdk";

import { countAuthContexts, selectInvocationForAddress } from "./authTree";

const SMART_ACCOUNT = "CB4KZJ3I4XANE6GWPAMXCNXQ34PTQWPXVKFBBMLNKV25GAOXQC7RQUMS";
const ASSET = "CCOUVA654JH2V6B7LNTKHJP5DF3QA553RS2IIWXSGPDFH2N3QILIVU5L";
const OTHER = "CAX766XYR56WO7Y4HFOHYQUO5AIN5QLHAHKJ3DINXM2WUQY5UE7KGE26";

function invocation(
  contractId: string,
  functionName: string,
  subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(),
        functionName,
        args: [],
      }),
    ),
    subInvocations,
  });
}

function entryFor(address: string, rootInvocation: xdr.SorobanAuthorizedInvocation) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
    rootInvocation,
  });
}

function sourceAccountEntry(rootInvocation: xdr.SorobanAuthorizedInvocation) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation,
  });
}

/**
 * What the testnet host actually records for `execute_transfer_payment`:
 * the SAC's `transfer` is a *direct* child of the root, because the adapter
 * hop in between is invoker-satisfied and never becomes an auth context.
 */
const transferTree = invocation(SMART_ACCOUNT, "execute_transfer_payment", [
  invocation(ASSET, "transfer"),
]);

/** And for `create_scheduled_payment`: a single node, no token movement. */
const scheduleTree = invocation(SMART_ACCOUNT, "create_scheduled_payment");

describe("countAuthContexts", () => {
  it("counts a leaf invocation as one context", () => {
    expect(countAuthContexts(scheduleTree)).toBe(1);
  });

  it("counts the nested SAC transfer as a second context", () => {
    // __check_auth receives one Context per node, and the AuthPayload must
    // carry one context_rule_id per Context or the contract rejects the call.
    expect(countAuthContexts(transferTree)).toBe(2);
  });

  it("counts every node of a deeper tree", () => {
    const tree = invocation(SMART_ACCOUNT, "execute_split_payment", [
      invocation(ASSET, "transfer"),
      invocation(ASSET, "transfer", [invocation(OTHER, "nested")]),
    ]);

    expect(countAuthContexts(tree)).toBe(4);
  });
});

describe("selectInvocationForAddress", () => {
  it("returns the invocation tree recorded for the given address", () => {
    const entries = [entryFor(SMART_ACCOUNT, transferTree)];

    expect(selectInvocationForAddress(entries, SMART_ACCOUNT)).toBe(transferTree);
  });

  it("ignores entries recorded for a different address", () => {
    const entries = [
      entryFor(OTHER, invocation(OTHER, "something")),
      entryFor(SMART_ACCOUNT, transferTree),
    ];

    expect(selectInvocationForAddress(entries, SMART_ACCOUNT)).toBe(transferTree);
  });

  it("skips source-account credentials, which carry no address to match", () => {
    const entries = [sourceAccountEntry(invocation(OTHER, "something"))];

    expect(selectInvocationForAddress(entries, SMART_ACCOUNT)).toBeNull();
  });

  it("returns null when no entry belongs to the address", () => {
    expect(selectInvocationForAddress([], SMART_ACCOUNT)).toBeNull();
  });
});
