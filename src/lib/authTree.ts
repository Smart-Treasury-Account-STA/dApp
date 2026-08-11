import { Address, xdr } from "@stellar/stellar-sdk";

/**
 * Counts the authorization contexts an invocation tree produces.
 *
 * `__check_auth` receives one `Context` per node in the tree, and the
 * `AuthPayload` must carry one `context_rule_id` per `Context` or the OZ
 * `do_check_auth` rejects the call. A payment moves tokens, so the SAC's
 * `transfer` is a second node and a second context; creating a scheduled
 * intent moves nothing and stays a single node.
 */
export function countAuthContexts(invocation: xdr.SorobanAuthorizedInvocation): number {
  return invocation
    .subInvocations()
    .reduce((total, sub) => total + countAuthContexts(sub), 1);
}

/**
 * Picks the invocation tree the simulation recorded for one address.
 *
 * Simulating without auth entries puts the host in recording mode, where it
 * reports the exact tree each address must authorize — including nodes the
 * caller cannot infer from the entrypoint alone, like the SAC `transfer` that
 * a treasury payment reaches through an adapter. Source-account credentials
 * carry no address and never match.
 */
export function selectInvocationForAddress(
  entries: xdr.SorobanAuthorizationEntry[],
  address: string,
): xdr.SorobanAuthorizedInvocation | null {
  for (const entry of entries) {
    const credentials = entry.credentials();
    if (
      credentials.switch().value !==
      xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
    ) {
      continue;
    }
    if (Address.fromScAddress(credentials.address().address()).toString() === address) {
      return entry.rootInvocation();
    }
  }

  return null;
}
