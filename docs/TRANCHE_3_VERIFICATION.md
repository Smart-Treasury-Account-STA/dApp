# Tranche 3 Verification Report — Smart Treasury Account (STA)

- **Date:** 2026-09-11
- **Tranche:** 3 — Mainnet Launch ([SCF submission][scf])
- **Production dApp:** [smarttreasury.io/app][app]
- **Documentation:** [smarttreasury.io/docs][docs]
- **SDK:** [`sta-sdk@0.2.1`][npm] on npm

[scf]: https://communityfund.stellar.org/submissions/recmj5cqlrqKyd1Bc
[app]: https://smarttreasury.io/app
[docs]: https://smarttreasury.io/docs
[npm]: https://www.npmjs.com/package/sta-sdk

---

## At a glance

| Deliverable                                     | Status       | Start here                               |
| ----------------------------------------------- | ------------ | ---------------------------------------- |
| [1 — Mainnet Contracts & TypeScript SDK][d1]    | ✅ Satisfied | [Mainnet deployment notes][docs-mainnet] |
| [2 — Production dApp & Relayer Monitoring][d2]  | ✅ Satisfied | [smarttreasury.io/app][app]              |
| [3 — Mainnet Documentation & Testing Guide][d3] | ✅ Satisfied | [smarttreasury.io/docs][docs]            |

**How to read "Satisfied".** Each deliverable is judged against its SCF _"how to measure completion"_ criterion, quoted verbatim at the top of its section. Items from the longer deliverable description that are partial or deferred are listed openly under **Scope notes** in the same section.

[d1]: #deliverable-1--mainnet-contracts--typescript-sdk
[d2]: #deliverable-2--production-dapp--relayer-monitoring
[d3]: #deliverable-3--mainnet-documentation--testing-guide
[docs-mainnet]: https://smarttreasury.io/docs/deployment/mainnet

## Quick verification path

1. **Open the production dApp** at [smarttreasury.io/app][app]. The header reads `Stellar mainnet`; `/app` opens the documented example treasury, and `/app/treasuries` lists the treasuries a wallet owns.
2. **Open a mainnet transaction** on stellar.expert — for example the relayer's execution of a scheduled payment, [`b1315be9…`][tx-relayer], sent by executor `GCCPEHVE…LIN6`. Every flow and its transactions are listed under [Deliverable 2][d2].
3. **Read the mainnet treasury with the SDK** — read-only, no key needed. Command and expected output are under [Deliverable 1][d1].
4. **Repeat the flow on a treasury of your own** with the [Testing support guide][docs-testing]: step by step, with expected results and the intended rejections, for well under 1 XLM of fees.
5. **Check the documentation set** — the five artifacts named in the criterion are linked under [Deliverable 3][d3].

[docs-testing]: https://smarttreasury.io/docs/operators/testing-guide

## Source code and CI

| Repository                         | Commit verified (`main`)                              | CI on that commit                                                                   |
| ---------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`smart-contracts`][gh-sc]         | [`0aaf5d3`][sc-commit]                                | ✅ [run 34502551032][sc-ci] — build, 164 tests across 10 crates, WASM fixture check |
| [`sdk`][gh-sdk] (`sta-sdk` on npm) | [`ec56202`][sdk-commit] = tag `v0.2.1` = npm `latest` | ✅ [CI 34544399351][sdk-ci] · [Publish 34544411910][sdk-publish]                    |
| [`dApp`][gh-dapp]                  | [`ddffe06`][dapp-commit]                              | ✅ [run 34548297439][dapp-ci] — format, lint, typecheck, test, build                |
| [`docs`][gh-docs]                  | [`65b3a84`][docs-commit]                              | ✅ [run 34548011800][docs-ci]                                                       |

Everything is on `main` in every repository (Tranche 2 material pointed at `testnet` and `v1-full-implementation`). Each commit above was the tip of `origin/main` at verification time.

[gh-sc]: https://github.com/Smart-Treasury-Account-STA/smart-contracts
[gh-sdk]: https://github.com/Smart-Treasury-Account-STA/sdk
[gh-dapp]: https://github.com/Smart-Treasury-Account-STA/dApp
[gh-docs]: https://github.com/Smart-Treasury-Account-STA/docs
[sc-commit]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/commit/0aaf5d319491dff5f17c79e04e0fa50b34690371
[sdk-commit]: https://github.com/Smart-Treasury-Account-STA/sdk/commit/ec56202cb4c3ac7822b81246339763493519f271
[dapp-commit]: https://github.com/Smart-Treasury-Account-STA/dApp/commit/ddffe066dbc39c16733105da1dc7da1929837034
[docs-commit]: https://github.com/Smart-Treasury-Account-STA/docs/commit/65b3a8462cab7566399fc1ce032d0ea10d6cc1b8
[sc-ci]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/actions/runs/34502551032
[sdk-ci]: https://github.com/Smart-Treasury-Account-STA/sdk/actions/runs/34544399351
[sdk-publish]: https://github.com/Smart-Treasury-Account-STA/sdk/actions/runs/34544411910
[dapp-ci]: https://github.com/Smart-Treasury-Account-STA/dApp/actions/runs/34548297439
[docs-ci]: https://github.com/Smart-Treasury-Account-STA/docs/actions/runs/34548011800

---

## Deliverable 1 — Mainnet Contracts & TypeScript SDK

**Status: ✅ Satisfied**

> _"Mainnet contract addresses are published. A developer can inspect the mainnet configuration and run SDK examples for documented flows."_

| Criterion                                       | Evidence                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Mainnet contract addresses are published        | [`MAINNET_DEPLOYMENT.md`][sc-mainnet-md] and the [Mainnet deployment][docs-mainnet] docs page          |
| A developer can inspect the mainnet config      | [`examples/read-treasury.ts`][sdk-read-treasury] run against mainnet, read-only, no key (output below) |
| … and run SDK examples for the documented flows | [`sta-sdk@0.2.1`][npm]: one example per flow, on mainnet with `STA_NETWORK=mainnet`                    |

Beyond the criterion, the deployed WASM is rebuilt from source and compared byte for byte (see [Reproducible build](#reproducible-build--verified-with-a-host-caveat)).

### Published addresses, verified against live state

[`docs/MAINNET_DEPLOYMENT.md`][sc-mainnet-md] in the smart-contracts repo records:

- the seven WASM hashes;
- the `account_factory` (`CCFIPN4T…QAAV`);
- the six contracts of a first treasury, deployed through the factory in one transaction (`smart_account` `CDTE6DBM…VL7W`);
- the initialization parameters: owner, founding signer, guardian threshold, executor, policy rules.

[`docs/MAINNET_TESTING_TRANSACTIONS.md`][sc-mainnet-tx] lists every setup and test transaction with a stellar.expert link:

- **Setup:** 7 uploads, factory deploy and `initialize`, `deploy_account`, funding, 7 policy writes.
- **14 landed payment/admin transactions:** XLM and USDC transfers, a split, a scheduled payment created, executed by the executor and a second one cancelled, `pause`/`unpause`, `extend_instance_ttl`, `add_signer`/`remove_signer`, `add_context_rule`.

The docs site mirrors it at [Mainnet deployment][docs-mainnet], including storage TTL management.

### Inspect the mainnet configuration with the SDK

Re-run on 2026-09-11 from the SDK repository — read-only, no key:

```sh
git clone --branch v0.2.1 https://github.com/Smart-Treasury-Account-STA/sdk.git && cd sdk
pnpm install
STA_NETWORK=mainnet STA_MAINNET_RPC_URL=https://soroban-rpc.mainnet.stellar.gateway.fm \
  npx tsx examples/read-treasury.ts
# network: mainnet · initialized: true, paused: false, frozen: false
# owner GAHNF7XS…NIY7 · policy version: 1 · context rules: 2
# factory wasm hashes: the six values of MAINNET_DEPLOYMENT.md §3, byte for byte
```

### Reproducible build — verified, with a host caveat

- **Pinned inputs.** Rust 1.94.1 ([`rust-toolchain.toml`][sc-toolchain], target `wasm32v1-none`), `Cargo.lock`, a deterministic release profile, and `stellar contract build --optimize` with **stellar-cli 26.0.0 exactly** — the CLI stamps its version into each artifact's `cliver` meta, so another version cannot match.
- **Local check.** [`scripts/verify_build.sh`][sc-verify] parses the expected hashes out of `MAINNET_DEPLOYMENT.md` and compares them. `--fixtures-only`, run on 2026-09-11: **6/6 MATCH** (`account_factory` is not a committed fixture and is skipped).
- **CI rebuild.** [CI run 34502551032][sc-ci] on `0aaf5d3` rebuilt those six contracts from source on `ubuntu-latest` (x86_64) with the pinned toolchain and compared them byte for byte (`cmp`) against the fixtures: the reference environment reproduces the deployed bytes.
- **`account_factory`** was separately rebuilt to its recorded hash from source (macOS, stellar-cli 26.0.0).
- **Caveat** (documented in `MAINNET_DEPLOYMENT.md` §3.1). On other hosts the same pinned toolchain yields equivalent but not identical bytes for some contracts (macOS arm64 5/7, Linux arm64 2/7; the differences sit inside the code section, meta identical). The script's `--container` mode (the CI recipe in a linux/amd64 container) has not yet been demonstrated outside CI.

### SDK — `sta-sdk@0.2.1`, published and consumed

- **Publishing.** Published by CI through npm trusted publishing (OIDC) from tag `v0.2.1`.
- **Network configuration.** Testnet (`TESTNET`) and mainnet (`mainnet(rpcUrl, { headers })`, `MAINNET_CONTRACTS`, `MAINNET_ASSETS`, and `buildMainnetConfig` for a self-deployed treasury). SDF runs no free mainnet RPC, so the provider is always explicit.
- **Transaction preparation** with SmartAccount custom authorization: Entry A `AuthPayload` + Entry B signer digest, the authorization tree discovered by recording-mode simulation, a market inclusion fee.
- **Typed event parsing and typed state reads.**
- **Tests:** 52.
- **Examples.** One runnable example per documented flow — read treasury, transfer, split, scheduled payment + cancel, event parsing — on testnet by default, on mainnet with `STA_NETWORK=mainnet`. The [README][sdk-readme]'s versioning table states which deployment each release targets (0.2.1 → mainnet record §4–§5).
- **Consumed by the dApp.** The dApp pins `sta-sdk` `0.2.1` exactly and builds on it: the four payment flows call `prepare*`, the relayer `prepareRelayerExecution`, treasury deployment `buildClassicAuthEntry`, and state reads go through the `state` module.
- **What stays in the dApp** has no SDK equivalent: the wallet signing callback, receipt handling, the context-rule selection UX, SAC balance and instance-storage reads, and the scheduled-intent event scan.

### Scope notes (not blocking)

- **Generated bindings.** Bindings produced with `stellar contract bindings typescript` live in `smart-contracts/sdk/generated/` (unpublished). The published SDK does not wrap them: generated clients pin one `@stellar/stellar-sdk` major, and a consumer loading two majors breaks `instanceof` on `Address`/`ScVal`. It encodes the same `#[contracttype]`s by hand, verified live and pinned by tests ([SDK README][sdk-readme], "Why this SDK hand-encodes calls…"). The published package is the canonical SDK.
- **Multi-signer rules.** A context rule with several signers and no policy requires all of them (OpenZeppelin `stellar-accounts` 0.7.2). The SDK builds Entry A/B for one signer; a shared Entry A for M-of-N is a documented known issue. Demonstrated live on mainnet ([testing record][sc-mainnet-tx] §6, #12–#14: `#3002 UnvalidatedContext`, then a two-signer recovery), and the dApp warns before any write that would make a rule unanimous.
- **Not deployed on mainnet:** `webauthn_verifier` (needed for passkey signers only), `governance_account` and `threshold_policy` (the owner is a single key for this launch), `ConditionVerifier` (optional, not built).
- **Example treasury** `CDTE6DBM…` is for integration testing; its owner key is documented as non-confidential. Treasuries meant to hold value are deployed fresh through the factory.
- **Timelocked flows** (guardian freeze and recovery, adapter change: ~24 h, 17 280 ledgers) are wired but not exercised on mainnet; they were exercised end to end on testnet ([`TESTNET_FACTORY_DEPLOYMENT.md`][sc-testnet-factory] §14, [`TESTNET_DEPLOYMENT.md`][sc-testnet] §5).
- **No independent third-party audit** — out of scope per the submission, and claimed nowhere (the docs site footer says so).

[sc-mainnet-md]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/blob/0aaf5d319491dff5f17c79e04e0fa50b34690371/docs/MAINNET_DEPLOYMENT.md
[sc-mainnet-tx]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/blob/0aaf5d319491dff5f17c79e04e0fa50b34690371/docs/MAINNET_TESTING_TRANSACTIONS.md
[sc-testnet-factory]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/blob/0aaf5d319491dff5f17c79e04e0fa50b34690371/docs/TESTNET_FACTORY_DEPLOYMENT.md
[sc-testnet]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/blob/0aaf5d319491dff5f17c79e04e0fa50b34690371/docs/TESTNET_DEPLOYMENT.md
[sc-verify]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/blob/0aaf5d319491dff5f17c79e04e0fa50b34690371/scripts/verify_build.sh
[sc-toolchain]: https://github.com/Smart-Treasury-Account-STA/smart-contracts/blob/0aaf5d319491dff5f17c79e04e0fa50b34690371/rust-toolchain.toml
[sdk-readme]: https://github.com/Smart-Treasury-Account-STA/sdk/blob/ec56202cb4c3ac7822b81246339763493519f271/README.md
[sdk-read-treasury]: https://github.com/Smart-Treasury-Account-STA/sdk/blob/ec56202cb4c3ac7822b81246339763493519f271/examples/read-treasury.ts

---

## Deliverable 2 — Production dApp & Relayer Monitoring

**Status: ✅ Satisfied**

> _"A reviewer can open the production dApp, connect a supported Stellar wallet, operate a mainnet treasury flow, view transaction status, and verify relayer monitoring for the scheduled payment flow."_

| Criterion                          | Evidence (details below)                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Open the production dApp           | [smarttreasury.io/app][app]; the header reads `Stellar mainnet`                      |
| Connect a supported Stellar wallet | Stellar Wallets Kit; Freighter signed every owner transaction below                  |
| Operate a mainnet treasury flow    | Deploy, policy, one-shot, scheduled, cancel and split — each with its mainnet tx     |
| View transaction status            | Toast with hash and explorer link; _pending_ and refusals reported by name           |
| Verify relayer monitoring          | Per-job status, ledger window and execution tx in the console; signed QStash trigger |

### Open the production dApp

- [smarttreasury.io/app][app] is the Vercel production deployment built from `main`.
- The header reads `Stellar mainnet`. The label is derived from the configured network passphrase ([`src/lib/network.ts`][dapp-network]), so a deployment cannot name the wrong network.
- `/app` opens the documented example treasury; `/app/treasuries` lists the treasuries a wallet owns and offers **Deploy new treasury** (factory `deploy_account`, one transaction).

### Connect a wallet

- Stellar Wallets Kit, offering Freighter, xBull, Albedo, LOBSTR, Rabet, Hana and Klever, constructed with the configured passphrase, which every `signTransaction`, `signAuthEntry` and `signMessage` call also passes.
- Freighter signed every owner transaction below; the relayer execution is signed server-side by the executor key.

### Operate a mainnet treasury flow

Treasury `CAAIQLZP…OXSC3` was deployed and operated from the production console with its owner's wallet (`GB2KHXT4…EQ4T`). For each transaction, Horizon confirms the source account, the invoked function, and `successful: true`.

| Flow                             | Contract call                                                                              | Transaction (stellar.expert)                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Deploy a treasury                | `account_factory.deploy_account`                                                           | [`60a906bf…`][tx-deploy]                                                                                          |
| Configure policy                 | `set_recipient_allowed`, `set_asset_rule` (1 XLM cap), `set_operation_allowed` ×2          | [`cd6c5fd4…`][tx-policy-1] · [`861088db…`][tx-policy-2] · [`22e5a36f…`][tx-policy-3] · [`b73cf500…`][tx-policy-4] |
| One-shot payment                 | `execute_transfer_payment`                                                                 | [`59701b78…`][tx-pay-1] (1 XLM) · [`7dce5d96…`][tx-pay-2] (0.1 XLM, on the SDK-based build)                       |
| Scheduled payment                | `create_scheduled_payment` — one execution, policy version 1 pinned                        | [`d544b29d…`][tx-schedule]                                                                                        |
| Relayer execution of that intent | `execute_scheduled_payment(b4e6670d…, 1)` by executor `GCCPEHVE…LIN6`, three minutes later | [`b1315be9…`][tx-relayer]                                                                                         |
| Cancel a scheduled payment       | `cancel_scheduled_payment`                                                                 | [`acdc343f…`][tx-cancel-1] · [`7313131a…`][tx-cancel-2]                                                           |
| Split payment                    | `execute_split_payment`, two destinations                                                  | [`2f28ff13…`][tx-split] (same owner's first treasury, `CB27DZEF…`)                                                |

- **Relayer activity.** Between 2026-09-10 15:07 and 2026-09-11 00:42 UTC the executor ran eight `execute_scheduled_payment` calls against this treasury, all successful.
- **Try it yourself.** A reviewer can repeat the whole flow on a treasury of their own with the [Testing support guide][docs-testing], for well under 1 XLM of fees.

### View transaction status

- Every write runs **policy check → simulate → sign → submit → poll** and ends in a toast carrying the hash and an explorer link.
- A transaction not confirmed within the polling window is reported as _pending_ — neither success nor failure.
- Refusals name their cause: the result code (`txBadAuth`, `txInsufficientFee`, …) or the contract error (`#2004 RecipientNotAllowed`, `#2005 AmountAboveLimit`, `#2006 VersionMismatch`, …).
- Policy rejections surface before any wallet prompt.

### Relayer monitoring for the scheduled payment flow

- **Monitoring view.** The console's **Scheduled payment relayer** section lists each job with its intent id, `child_sequence`, status (`scheduled` / `executing` / `executed` / `failed`), the relayer's last note, the ledger window, and a link to the execution transaction. **Execute** is disabled on terminal jobs and while another run holds the job; **Queue relayer** turns into **Queued**.
- **Execution safety.** Jobs live in Neon Postgres with optimistic versioning and a five-minute executing lease, so two instances never submit the same child. Before each submission the relayer re-reads the canonical intent and `is_child_executed` on chain and enforces the ledger window; the contract stays the authority.
- **No authority for the executor.** `execute_scheduled_payment(intent_id, child_sequence)` takes nothing else from its caller: the executor key holds no funds and cannot change asset, destination, amount, policy version or window.
- **Access.** No operator token in the browser. **Queue relayer** and **Execute** open a session with a wallet-signed message (SEP-53) bound to that address, and the server checks on chain that the address signs for that treasury.
- **Scheduled trigger.** An Upstash QStash schedule calls `POST /app/api/relayer/run`, and the route verifies QStash's signature against a pinned URL ([`src/lib/relayer/qstash.ts`][dapp-qstash]). Checked live on 2026-09-11: an unsigned POST gets `401`. The schedule itself is registered in the QStash console (setup documented in the [dApp README][dapp-readme], "Scheduled Trigger").
- **Manual fallback.** The console's **Execute**, or `pnpm relayer:run` with the operator token — safe to rerun, because the on-chain child check refuses a second execution.

### Quality gates

- **Tests:** 422 in 38 files (relayer executor, store, lease, QStash verification, wallet proof, env validation, network label, …).
- **CI** on `ddffe06` ([run 34548297439][dapp-ci]) runs format check, lint, typecheck, tests, and a production build with the environment pulled from Vercel: green.
- **Dependencies:** `pnpm audit` reports no known vulnerabilities since the dependency update merged into `main` after `ddffe06`:
  - Next.js 16.3.4;
  - the wallet kit's Trezor, Ledger, WalletConnect and HOT Wallet SDKs (NEAR, Solana), which the app never offered or has patched out, are not installed;
  - the remaining transitive fixes are pinned by `overrides` in `pnpm-workspace.yaml` (details in the [developer guide][dapp-dev-guide], §2.1).

### Scope notes — not yet complete, stated publicly

These deliverable-description items are not yet complete. All are stated publicly on the docs [Status][docs-status] and [Operator guide][docs-operators] pages.

- **Recovery screens.** Guardians can be added and checked in the console; freeze, recovery request, approval and finalization run through the SDK or the CLI.
- **Audit-history view.** Policy-version changes, replay attempts, recovery and pause/freeze transitions are typed events, parseable with the SDK (`parseContractEvents`, [`examples/parse-events.ts`][sdk-parse-events]), but the console has no history view yet; its scheduled-payment list is built from `IntentCreated` events.
- **Alerting.** A failed run is retried by QStash and reported to its failure callback. There are no dedicated alerts yet for a low executor balance, a missed window or RPC unavailability, and no structured logging beyond QStash's per-run response log. The documented fallback is the two manual paths above (console **Execute**, `pnpm relayer:run`).
- **Network selection.** One deployment per network (production = mainnet; testnet runs locally), no in-app switch. The wallet's active network is not checked before signing; a signature for the wrong network is refused by the network (`txBadAuth`) and shown by name.
- **RPC headers.** Supported by the SDK (`NetworkConfig.rpcHeaders`), not yet passed by the dApp; production uses a URL-keyed public RPC.
- **Minor.** The payment form's replay nonce is drawn with `Math.random()` (a repeat is refused by `is_nonce_used`; the SmartAccount authorization nonce comes from the SDK's CSPRNG). `/api/treasuries` has no rate limit (each registration is ownership-checked on chain first).

[dapp-network]: https://github.com/Smart-Treasury-Account-STA/dApp/blob/ddffe066dbc39c16733105da1dc7da1929837034/src/lib/network.ts
[dapp-qstash]: https://github.com/Smart-Treasury-Account-STA/dApp/blob/ddffe066dbc39c16733105da1dc7da1929837034/src/lib/relayer/qstash.ts
[dapp-readme]: https://github.com/Smart-Treasury-Account-STA/dApp/blob/ddffe066dbc39c16733105da1dc7da1929837034/README.md
[dapp-dev-guide]: https://github.com/Smart-Treasury-Account-STA/dApp/blob/main/docs/DEVELOPER_GUIDE.md
[sdk-parse-events]: https://github.com/Smart-Treasury-Account-STA/sdk/blob/ec56202cb4c3ac7822b81246339763493519f271/examples/parse-events.ts
[docs-status]: https://smarttreasury.io/docs/status
[docs-operators]: https://smarttreasury.io/docs/operators/
[tx-deploy]: https://stellar.expert/explorer/public/tx/60a906bf8ba165e1e148f6276080ce62576be78444d89bd1e5da093247d2093a
[tx-policy-1]: https://stellar.expert/explorer/public/tx/cd6c5fd40d6680c6cd7fa85868466b0706f84400b23cdbf279d60e0a3fc43a6c
[tx-policy-2]: https://stellar.expert/explorer/public/tx/861088dbc91b5148ab6cfb1cda003e6d43e7e6a1c1ed3b0839727eb1a883b3a2
[tx-policy-3]: https://stellar.expert/explorer/public/tx/22e5a36f7e0e4c05376a01d5b7472611d6a73a9b1b1fbfddeb2a1684b1fc7f28
[tx-policy-4]: https://stellar.expert/explorer/public/tx/b73cf5004a09f9c6413fe278d04193c16829a06f3edc574c15fc4200d0370acc
[tx-pay-1]: https://stellar.expert/explorer/public/tx/59701b78533487423cc60ec9d2e4a37212b9443c082d060b245c5cfbbc62921c
[tx-pay-2]: https://stellar.expert/explorer/public/tx/7dce5d96b47643db8a38e9b18b163ea56216a5efeb53961de2efc00ce05086ad
[tx-schedule]: https://stellar.expert/explorer/public/tx/d544b29d143d12d924bcbd49cc46f66321908775a63b5731c7429f7672758c8e
[tx-relayer]: https://stellar.expert/explorer/public/tx/b1315be9775b7a6eccb7050abfc8bb06ecf3035800db8245e80a877bdd7fe2b9
[tx-cancel-1]: https://stellar.expert/explorer/public/tx/acdc343f8046d60dd64601ea40d13b3f319b40ad7da55cd04e77fde3caa99e1a
[tx-cancel-2]: https://stellar.expert/explorer/public/tx/7313131a3c197246aa7a30178066ada30ad161f011f9dcc20e87c991fad22cb0
[tx-split]: https://stellar.expert/explorer/public/tx/2f28ff1318afdff373e396dcaabe38cc7d47b971fb454cd39db61a9bc2a1b5ed

---

## Deliverable 3 — Mainnet Documentation & Testing Guide

**Status: ✅ Satisfied**

> _"Documentation and testing support materials are available, including the operator guide, SDK usage guide, deployment notes, testing support guide, and release checklist."_

All published on the VitePress site ([`docs`][gh-docs] repo, `main`); every page below answered HTTP 200 on 2026-09-11.

### The five artifacts named in the criterion

1. ✅ **Operator guide** — [/docs/operators/][docs-operators]. Covers treasury deployment, reading state, signers and context rules, policy rules, payments, scheduled payments, relayer, pause/freeze/recovery, TTL maintenance.
2. ✅ **SDK usage guide** — [/docs/sdk/][docs-sdk] and the [npm README][npm]. Covers installation, testnet/mainnet configuration, one example per flow, modules, versioning.
3. ✅ **Deployment notes** — [/docs/deployment/mainnet][docs-mainnet] and [`MAINNET_DEPLOYMENT.md`][sc-mainnet-md]. Covers addresses, WASM hashes, reproducible build, deployment parameters, storage TTLs, network configuration.
4. ✅ **Testing support guide** — [/docs/operators/testing-guide][docs-testing]. A step-by-step walkthrough with expected results, including the intended rejections (`#2004`, `#2005`, `#2006`, `#3002`); CLI probes reproducible without a wallet; what cannot be done in one sitting on mainnet.
5. ✅ **Release checklist** — [/docs/operators/release-checklist][docs-release]. Covers contracts, SDK, dApp/relayer, docs, post-release.

### Also published

- **Issue reporting** — [/docs/operators/reporting-issues][docs-issues]. Private advisories for vulnerabilities, GitHub issues for bugs, documentation corrections.
- **Security model** — [/docs/security/][docs-security], [policy-version pinning][docs-pinning], [replay protection][docs-replay]. Fail-closed defaults, invariants, what the relayer cannot do; freeze as a one-way stop ([SmartAccount][docs-smart-account]).
- **Transaction record** — [`MAINNET_TESTING_TRANSACTIONS.md`][sc-mainnet-tx] (smart-contracts). Every mainnet setup and test transaction, with explorer links.

### Scope note

The docs state the limits above in plain terms — no third-party audit (site footer), no recovery screen, any-one-of-N rules not deployed — rather than describing planned work as live.

[docs-sdk]: https://smarttreasury.io/docs/sdk/
[docs-release]: https://smarttreasury.io/docs/operators/release-checklist
[docs-issues]: https://smarttreasury.io/docs/operators/reporting-issues
[docs-security]: https://smarttreasury.io/docs/security/
[docs-pinning]: https://smarttreasury.io/docs/security/policy-version-pinning
[docs-replay]: https://smarttreasury.io/docs/security/replay-protection
[docs-smart-account]: https://smarttreasury.io/docs/contracts/smart-account

---

## Bottom line

All three completion criteria are met on Stellar mainnet:

- **Deliverable 1** — contracts deployed with published, rebuildable hashes, and a published SDK whose examples run against them.
- **Deliverable 2** — a production dApp that deploys and operates a treasury from a wallet, with a scheduled-payment relayer that runs on a schedule, cannot execute twice, and shows each job's state.
- **Deliverable 3** — the five named documentation artifacts, plus the security model and the issue process, published.

### Follow-ups (not blocking, in priority order)

1. Recovery screens, and an audit-history view built from typed events.
2. Relayer alerting (executor balance, missed window, RPC), structured logs, a written runbook.
3. A wallet-network check before signing; RPC headers in the dApp; a CSPRNG for the payment nonce; a rate limit on `/api/treasuries`.
4. Multi-signer: deploy `threshold_policy` for any-one-of-N, or build the shared Entry A for M-of-N.
5. An independent audit before treasuries hold significant value.
