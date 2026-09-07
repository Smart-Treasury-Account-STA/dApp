#!/usr/bin/env node
/**
 * One-off QA script: calls smart_account.add_context_rule directly.
 *
 * Why this exists: `add_context_rule` is gated by
 * `env.current_contract_address().require_auth()` (the smart_account
 * authorizing *itself*), not a plain owner keypair signature -- so a bare
 * `stellar contract invoke` can't sign it ("Missing signing key for
 * account C..." is the CLI trying to find an Ed25519 key for a contract
 * address, which doesn't exist). This needs the same Entry A + Entry B
 * custom-auth construction the dApp/SDK use for payments, built here with
 * sta-sdk's exported primitives.
 *
 * Usage:
 *   OWNER_SECRET=S... \
 *   SMART_ACCOUNT_ID=CAOTDU4H6A3QVJKLRKI7FZXMFMJ7QD2IHKBAJKCLGAUXISFIRXNYRTHU \
 *   NEW_SIGNER_ADDRESS=G... \
 *   node scripts/add-context-rule.mjs
 *
 * OWNER_SECRET must be the treasury's owner AND a delegated signer on
 * context rule 0 (true for any Tier 1 guided deploy) -- this script
 * authorizes under rule 0, since rule 0 is `Default` type and matches any
 * context, including this self-call.
 */
import {
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { TESTNET, buildInvocation, buildSmartAccountAuthEntries, signAndSubmit } from "sta-sdk";

const ownerSecret = requireEnv("OWNER_SECRET");
const smartAccountId = requireEnv("SMART_ACCOUNT_ID");
const newSignerAddress = requireEnv("NEW_SIGNER_ADDRESS");
const ruleName = process.env.RULE_NAME ?? "rule1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this script.`);
  return value;
}

function addressScVal(id) {
  return new Address(id).toScVal();
}

/** Soroban SDK's standard #[contracttype] enum encoding: a vector of the
 * variant's symbol followed by its payload (empty for a unit variant). */
function enumScVal(variant, ...payload) {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), ...payload]);
}

async function main() {
  const owner = Keypair.fromSecret(ownerSecret);
  const server = new rpc.Server(TESTNET.rpcUrl);

  const args = [
    enumScVal("Default"), // context_type: ContextRuleType
    xdr.ScVal.scvString(ruleName), // name: String
    xdr.ScVal.scvVoid(), // valid_until: Option<u32> = None
    xdr.ScVal.scvVec([enumScVal("Delegated", addressScVal(newSignerAddress))]), // signers: Vec<Signer>
    xdr.ScVal.scvMap([]), // policies: Map<Address, Val>
  ];

  const rootInvocation = buildInvocation({
    contractId: smartAccountId,
    functionName: "add_context_rule",
    args,
  });

  const latestLedger = await server.getLatestLedger();
  const signatureExpirationLedger = latestLedger.sequence + 100;

  const [[entryA, entryB], sourceAccount] = await Promise.all([
    buildSmartAccountAuthEntries({
      smartAccountId,
      rootInvocation,
      signerAddress: owner.publicKey(),
      sign: owner,
      networkPassphrase: TESTNET.networkPassphrase,
      contextRuleIds: [0],
      signatureExpirationLedger,
    }),
    server.getAccount(owner.publicKey()),
  ]);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: smartAccountId,
        function: "add_context_rule",
        args,
        auth: [entryA, entryB],
      }),
    )
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(builder);
  const result = await signAndSubmit(TESTNET, prepared, owner);
  console.log("add_context_rule succeeded, ledger:", result.ledger);
  console.log("New ContextRule:", result.returnValue ? scValToNative(result.returnValue) : "(no return value)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
