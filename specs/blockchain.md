# Blockchain Standards

Install blockchain tooling only when the project requires it. Keep the stack minimal and select tools based on the product's chains, wallet flows, smart-contract needs, and deployment model.

## Preferred stack

- Viem for Ethereum interactions, encoding, decoding, and transport clients.
- Wagmi for React wallet and account integrations.
- MetaMask SDK when the product needs MetaMask-specific connectivity or features.
- WalletConnect for multi-wallet connectivity.
- Foundry for Solidity development, testing, scripting, and local workflows.
- Hardhat when its ecosystem, plugin support, or the existing repository requires it.
- OpenZeppelin Contracts for standard, audited contract primitives.
- OpenZeppelin Defender when managed operational automation is relevant.

Prefer Viem over ethers. Add ethers only for an unavoidable dependency or a documented compatibility reason.

## Implementation rules

- Separate chain configuration, contract ABIs, addresses, read operations, write operations, and UI concerns.
- Type contract interactions from ABIs and avoid manually duplicated signatures.
- Treat all wallet, network, transaction, and RPC data as untrusted external input.
- Make unsupported network, rejected signature, pending transaction, and reverted transaction states explicit in the UI.
- Never embed private keys, seed phrases, RPC secrets, or deployment credentials in source code or client bundles.
- Use environment variables for public RPC endpoints where appropriate and server-side secrets for privileged operations.
- Validate addresses, chain IDs, units, and user-entered amounts before submitting a transaction.
- Prefer integer-safe unit helpers such as Viem's `parseUnits` and `formatUnits`; never use JavaScript floating point for token values.

## Smart contracts

- Use established OpenZeppelin implementations before writing custom token, access-control, or upgrade logic.
- Write tests for authorization, expected failure paths, events, accounting, and meaningful edge cases.
- Include deployment and verification steps when contracts are part of the deliverable.
- Do not claim that a contract is audited unless an independent audit has actually occurred.
