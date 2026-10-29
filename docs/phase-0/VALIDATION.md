# Phase 0 Validation Record

Date: 2026-10-24  
Scope: foundation and dependency proof only

## Acceptance evidence

| Check                                              | Status                    | Evidence or blocker                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned Node, pnpm, Rust, and direct dependencies   | Complete                  | Frozen pnpm install and Cargo lock resolution passed; CI pins Node 22, pnpm 12.14.0, and Rust 1.99.1                                                                                                        |
| TypeScript formatting, typecheck, tests, and build | Complete                  | Prettier, ESLint, all workspace typechecks, 14 tests, and all TypeScript and Next.js production builds passed locally                                                                                       |
| Rust format, Clippy, and unit tests                | Complete                  | `cargo fmt`, Clippy with warnings denied, and 3 contract unit tests passed on Rust 1.99.1                                                                                                                   |
| Contract WASM build                                | Complete locally          | Direct locked Rust WASM build produced a 160,180-byte artifact with SHA-256 `49B775BC...B9D3B`; cargo-near remains an Ubuntu CI gate                                                                        |
| Testnet deploy, initialize, and view call          | Complete                  | `oceanear.testnet` deployed and initialized atomically; transaction `FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1` reached `FINAL`; `get_status` returned owner `oceanear.testnet` and `phase-0-ready`      |
| Sandbox deploy and view call                       | Deferred to Ubuntu CI     | Native Windows is unsupported; the product owner approved proceeding after the stronger live testnet deploy/call proofs passed. This remains a release gate                                                 |
| Wallet Selector testnet connection                 | Complete                  | Meteor Wallet connected `oceanear.testnet` on `testnet`; the web shell displayed the exact active account and matching contract owner                                                                       |
| Harmless owner-signed testnet call                 | Complete                  | Wallet-signed zero-deposit `set_status` reached `FINAL` in transaction `MFaieneZw88gcdhwSsneX5h6jBibeNrDjmJQGPow7Nd`; final state is `wallet-proof-confirmed`                                               |
| Restricted keeper function-call key proof          | Complete                  | Added a 0.25 NEAR allowance key restricted to receiver `oceanear.testnet` and method `keeper_ping`; the ping reached `FINAL`, while `set_status` was rejected with `AccessKeyMethodNameMismatchActionError` |
| Sponsored nonpayable owner call                    | Complete                  | Policy-approved NEP-366 call reached `FINAL` through `oceanrelayer.testnet`; owner total balance delta was 0 and relayer paid `229145572737100000000` yoctoNEAR                                             |
| Relayer policy and signature rejection cases       | Complete                  | 8 tests validate genuine NEP-366 signatures and reject altered args, receiver, method, deposit, expiry, and excess gas                                                                                      |
| Dependency vulnerability audit                     | Complete                  | `pnpm audit --audit-level high` reported no known vulnerabilities                                                                                                                                           |
| Working-tree private-key pattern scan              | Complete locally          | High-confidence scan found zero matching files; Git history cannot be scanned because the workspace is not yet a Git repository                                                                             |
| HOT Kit decision                                   | Complete for MVP baseline | Wallet Selector remains primary; details in `WALLET_DECISION.md`                                                                                                                                            |

## Required testnet evidence format

Do not mark a live proof complete without recording:

- network ID and exact contract account ID;
- signer account ID, never its key;
- method name and decoded arguments;
- transaction hash and final RPC status;
- expected contract state after finality;
- NearBlocks testnet URL built from the validated hash;
- for the keeper, the on-chain access-key permission showing receiver and method restriction;
- for the relayer, user balance before and after plus relayer balance change sufficient to show sponsorship.

## Exit gate

Phase 0 is accepted for Phase 1 work. On 2026-10-24, the product owner authorized proceeding after the live testnet deploy, restricted keeper call, sponsored relayer call, and wallet-signed owner call passed. The Ubuntu sandbox/CI run remains mandatory before release.

## Local environment notes

- The available local launcher used Node 24.19.0 and pnpm 11.25.0, so pnpm emitted an engine warning. The repository and CI intentionally require Node 22 and pnpm 12.14.0; all TypeScript gates still passed against the frozen lockfile.
- Installing `cargo-near` 0.22.0 on Windows reached its vendored OpenSSL build and failed because Git's bundled Perl lacks `Locale::Maketext::Simple`. The contract itself compiled successfully with the pinned Rust compiler. The official Ubuntu CI job remains the source of truth for the cargo-near build.
- WSL2 Ubuntu is present, but downloading the pinned Rust 1.99.1 toolchain timed out twice. No sandbox result is claimed.
- No GitHub Actions run exists yet because this directory has not been initialized and pushed as a Git repository.
- The Phase 0 contract is live at `oceanear.testnet` with code hash `5xm1roEubS6ectEGfdckCMnchcaU6CAXiYbtNdkd5EhQ`.
- Deployment evidence: <https://testnet.nearblocks.io/txns/FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1>.
- Restricted keeper key creation: <https://testnet.nearblocks.io/txns/4WTspQRhaAK9FA6Ur2BZmAD7hZfAoCtATywSKgpcZBXx>.
- Restricted keeper call: <https://testnet.nearblocks.io/txns/DdDZQzEGBFWbAvQfb1cr5t1qyBo1y8ar2xF1St8UaNNd>. Final state records `last_keeper` as `oceankeeper.testnet`.
- Sponsored relayer call: <https://testnet.nearblocks.io/txns/5tXH5JGDeyf9WhkCED94E9D7yqGtERNEh3HhYYrEcY7H>. Final state reached `relayed-call-confirmed` with no owner total-balance reduction.
- Wallet-signed owner call: <https://testnet.nearblocks.io/txns/MFaieneZw88gcdhwSsneX5h6jBibeNrDjmJQGPow7Nd>. RPC confirmed signer and receiver `oceanear.testnet`, `FINAL` execution, and status `wallet-proof-confirmed`.
- The Phase 0 web shell returned HTTP 200, connected Meteor Wallet on testnet, and completed its signed-call path.
